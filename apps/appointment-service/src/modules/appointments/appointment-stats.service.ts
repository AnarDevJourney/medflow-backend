import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppException, ErrorCode } from '@medflow/common';
import { addDays, clinicInstant, clinicToday } from './clinic-time';
import { StatsQueryDto } from './dto/stats-query.dto';
import { AppointmentStatus } from './entities/appointment.entity';

const STATUSES = Object.values(AppointmentStatus);
type StatusCounts = Record<AppointmentStatus, number>;
const MAX_RANGE_DAYS = 366;
const DEFAULT_RANGE_DAYS = 30;
const TZ = 'Asia/Baku';

const zeroCounts = (): StatusCounts =>
  Object.fromEntries(STATUSES.map((s) => [s, 0])) as StatusCounts;

// "Did not come" share of the visits that are over: no-show / (completed +
// no-show) — cancellations and future visits are not counted (user
// decision 7.5). null when nothing is over yet.
const noShowRate = (completed: number, noShow: number): number | null =>
  completed + noShow === 0
    ? null
    : Math.round((noShow / (completed + noShow)) * 1000) / 10;

// ISO weekday 1 (Mon) … 7 (Sun) of a calendar day
const isoWeekday = (date: string) =>
  new Date(`${date}T00:00:00Z`).getUTCDay() || 7;

const daysBetween = (from: string, to: string): string[] => {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
};

export interface OverviewStats {
  from: string;
  to: string;
  total: number;
  byStatus: StatusCounts;
  noShowRate: number | null; // %, one decimal
  daily: ({ date: string } & StatusCounts)[]; // every day of the range
  departments: {
    departmentId: string;
    name: string;
    code: string;
    count: number;
  }[];
  doctors: { doctorId: string; name: string; count: number }[]; // top 5
}

export interface DoctorStats {
  today: number;
  thisWeek: number;
  next7Days: number;
  weeklyAverage: number; // last 8 full weeks, one decimal
  noShowRate: number | null; // last 90 days
  daily: { date: string; count: number }[]; // last 14 days incl. today
}

// Appointment numbers for the dashboards (DOC 8.5). Raw SQL, grouped by
// the clinic's calendar day. Cancelled visits are left out of "how busy"
// counts (they did not take a slot in the end) but kept in byStatus.
@Injectable()
export class AppointmentStatsService {
  constructor(private readonly dataSource: DataSource) {}

  async overview(query: StatsQueryDto): Promise<OverviewStats> {
    const to = query.to ?? clinicToday();
    const from = query.from ?? addDays(to, -(DEFAULT_RANGE_DAYS - 1));
    if (from > to) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
        'to must not be before from',
        { field: 'to' },
      );
    }
    if (addDays(from, MAX_RANGE_DAYS - 1) < to) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
        `At most ${MAX_RANGE_DAYS} days at once`,
        { field: 'from' },
      );
    }
    const params = [
      clinicInstant(from, '00:00'),
      clinicInstant(addDays(to, 1), '00:00'),
    ];
    const range = 'starts_at >= $1 AND starts_at < $2';

    const [daily, departments, doctors] = await Promise.all([
      this.dataSource.query<
        { day: string; status: AppointmentStatus; n: number }[]
      >(
        `SELECT to_char(starts_at AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS day, status, count(*)::int AS n
           FROM appointments WHERE ${range} GROUP BY 1, 2`,
        params,
      ),
      this.dataSource.query<
        { id: string; name: string; code: string; n: number }[]
      >(
        `SELECT department_id AS id, max(department_name) AS name, max(department_code) AS code, count(*)::int AS n
           FROM appointments WHERE ${range} AND status <> 'CANCELLED'
          GROUP BY department_id ORDER BY n DESC, name`,
        params,
      ),
      this.dataSource.query<{ id: string; name: string; n: number }[]>(
        `SELECT doctor_id AS id, max(doctor_name) AS name, count(*)::int AS n
           FROM appointments WHERE ${range} AND status <> 'CANCELLED'
          GROUP BY doctor_id ORDER BY n DESC, name LIMIT 5`,
        params,
      ),
    ]);

    const byDay = new Map(daysBetween(from, to).map((d) => [d, zeroCounts()]));
    const byStatus = zeroCounts();
    for (const row of daily) {
      const counts = byDay.get(row.day);
      if (counts) counts[row.status] += row.n;
      byStatus[row.status] += row.n;
    }
    return {
      from,
      to,
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      byStatus,
      noShowRate: noShowRate(byStatus.COMPLETED, byStatus.NO_SHOW),
      daily: [...byDay].map(([date, counts]) => ({ date, ...counts })),
      departments: departments.map((d) => ({
        departmentId: d.id,
        name: d.name,
        code: d.code,
        count: d.n,
      })),
      doctors: doctors.map((d) => ({
        doctorId: d.id,
        name: d.name,
        count: d.n,
      })),
    };
  }

  // The signed-in doctor's own numbers
  async forDoctor(doctorId: string): Promise<DoctorStats> {
    const today = clinicToday();
    const monday = addDays(today, -(isoWeekday(today) - 1));
    const from14 = addDays(today, -13);
    const weeksFrom = addDays(monday, -56); // 8 full weeks before this one
    const from90 = addDays(today, -89);
    const at = (d: string) => clinicInstant(d, '00:00');

    const [counts] = await this.dataSource.query<
      {
        today: number;
        week: number;
        next7: number;
        weeks8: number;
        completed: number;
        noshow: number;
      }[]
    >(
      `SELECT
         count(*) FILTER (WHERE starts_at >= $2 AND starts_at < $3 AND status <> 'CANCELLED')::int AS today,
         count(*) FILTER (WHERE starts_at >= $4 AND starts_at < $5 AND status <> 'CANCELLED')::int AS week,
         count(*) FILTER (WHERE starts_at >= $3 AND starts_at < $6 AND status <> 'CANCELLED')::int AS next7,
         count(*) FILTER (WHERE starts_at >= $7 AND starts_at < $4 AND status <> 'CANCELLED')::int AS weeks8,
         count(*) FILTER (WHERE starts_at >= $8 AND starts_at < $3 AND status = 'COMPLETED')::int AS completed,
         count(*) FILTER (WHERE starts_at >= $8 AND starts_at < $3 AND status = 'NO_SHOW')::int AS noshow
       FROM appointments WHERE doctor_id = $1`,
      [
        doctorId,
        at(today),
        at(addDays(today, 1)),
        at(monday),
        at(addDays(monday, 7)),
        at(addDays(today, 8)),
        at(weeksFrom),
        at(from90),
      ],
    );
    const daily = await this.dataSource.query<{ day: string; n: number }[]>(
      `SELECT to_char(starts_at AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS day, count(*)::int AS n
         FROM appointments
        WHERE doctor_id = $1 AND starts_at >= $2 AND starts_at < $3 AND status <> 'CANCELLED'
        GROUP BY 1`,
      [doctorId, at(from14), at(addDays(today, 1))],
    );
    const perDay = new Map(daily.map((r) => [r.day, r.n]));
    return {
      today: counts.today,
      thisWeek: counts.week,
      next7Days: counts.next7,
      weeklyAverage: Math.round((counts.weeks8 / 8) * 10) / 10,
      noShowRate: noShowRate(counts.completed, counts.noshow),
      daily: daysBetween(from14, today).map((date) => ({
        date,
        count: perDay.get(date) ?? 0,
      })),
    };
  }
}
