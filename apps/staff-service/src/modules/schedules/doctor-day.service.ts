import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThanOrEqual, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { AppException, ErrorCode, Role } from '@medflow/common';
import {
  StaffMember,
  StaffStatus,
} from '../staff/entities/staff-member.entity';
import { TimeOff, TimeOffType } from '../time-off/entities/time-off.entity';
import { clinicToday } from '../time-off/time-off.mapper';
import { DoctorSchedule } from './entities/doctor-schedule.entity';
import { toHHmm } from './schedule.mapper';

export type NotWorkingReason =
  'NOT_A_DOCTOR' | 'DEACTIVATED' | TimeOffType | 'NOT_SCHEDULED';

export interface WorkingDay {
  working: true;
  date: string;
  start: string; // 'HH:mm'
  end: string;
  slotMinutes: number;
  doctorName: string;
  departmentId: string | null;
  departmentName: string | null;
  departmentCode: string | null;
}

export interface NotWorkingDay {
  working: false;
  date: string;
  reason: NotWorkingReason;
}

export type DoctorDay = WorkingDay | NotWorkingDay;

// One day in a range answer: the doctor's name / department are given once
export type RangeDay =
  | {
      date: string;
      working: true;
      start: string;
      end: string;
      slotMinutes: number;
    }
  | { date: string; working: false; reason: NotWorkingReason };

export interface DoctorDays {
  userId: string;
  doctorName: string;
  departmentId: string | null;
  departmentName: string | null;
  departmentCode: string | null;
  days: RangeDay[];
}

// Longest range the calendar may ask for in one call
export const MAX_RANGE_DAYS = 31;

const addDays = (date: string, n: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// ISO weekday of a calendar day: 1 = Monday … 7 = Sunday. Read as UTC so
// the server's time zone never shifts the day.
export const isoWeekday = (date: string): number =>
  new Date(`${date}T00:00:00Z`).getUTCDay() || 7;

// One day of a doctor for booking (appointment-service). The first rule
// that matches wins: role → status → time off → weekly schedule.
// Invited doctors count as working: they can be booked before first login.
@Injectable()
export class DoctorDayService {
  constructor(
    @InjectRepository(StaffMember)
    private readonly staff: Repository<StaffMember>,
    @InjectRepository(TimeOff)
    private readonly timeOff: Repository<TimeOff>,
    @InjectRepository(DoctorSchedule)
    private readonly schedules: Repository<DoctorSchedule>,
  ) {}

  // Many doctors × many days in three queries (appointment calendar): the
  // same rules as day(), for every doctor who is not deactivated, by name
  async days(query: {
    from: string;
    to: string;
    departmentId?: string;
    doctorId?: string;
  }): Promise<DoctorDays[]> {
    const dates: string[] = [];
    for (let d = query.from; d <= query.to; d = addDays(d, 1)) {
      dates.push(d);
      if (dates.length > MAX_RANGE_DAYS) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.BAD_REQUEST,
          `At most ${MAX_RANGE_DAYS} days at once`,
        );
      }
    }
    if (dates.length === 0) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
        'to must not be before from',
      );
    }

    const doctors = await this.staff.find({
      where: {
        role: Role.DOCTOR,
        status: Not(StaffStatus.DEACTIVATED),
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        ...(query.doctorId ? { userId: query.doctorId } : {}),
      },
      relations: { department: true },
      order: { lastName: 'ASC', firstName: 'ASC' },
    });
    if (doctors.length === 0) return [];
    const ids = doctors.map((d) => d.id);
    const [weeks, leaves] = await Promise.all([
      this.schedules.find({
        where: { staffMemberId: In(ids), isActive: true },
      }),
      this.timeOff.find({
        where: {
          staffMemberId: In(ids),
          startDate: LessThanOrEqual(query.to),
          endDate: MoreThanOrEqual(query.from),
        },
        order: { startDate: 'ASC' },
      }),
    ]);

    return doctors.map((member) => ({
      userId: member.userId,
      doctorName: `${member.firstName} ${member.lastName}`,
      departmentId: member.department?.id ?? null,
      departmentName: member.department?.name ?? null,
      departmentCode: member.department?.code ?? null,
      days: dates.map((date): RangeDay => {
        const leave = leaves.find(
          (l) =>
            l.staffMemberId === member.id &&
            l.startDate <= date &&
            l.endDate >= date,
        );
        if (leave) return { date, working: false, reason: leave.type };
        const slot = weeks.find(
          (w) =>
            w.staffMemberId === member.id && w.dayOfWeek === isoWeekday(date),
        );
        if (!slot) return { date, working: false, reason: 'NOT_SCHEDULED' };
        return {
          date,
          working: true,
          start: toHHmm(slot.startTime),
          end: toHHmm(slot.endTime),
          slotMinutes: slot.slotMinutes,
        };
      }),
    }));
  }

  async day(userId: string, date = clinicToday()): Promise<DoctorDay> {
    const member = await this.staff.findOne({
      where: { userId },
      relations: { department: true },
    });
    if (!member) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Staff member not found',
      );
    }
    const off = (reason: NotWorkingReason): NotWorkingDay => ({
      working: false,
      date,
      reason,
    });

    if (member.role !== Role.DOCTOR) return off('NOT_A_DOCTOR');
    if (member.status === StaffStatus.DEACTIVATED) return off('DEACTIVATED');

    const leave = await this.timeOff.findOne({
      where: {
        staffMemberId: member.id,
        startDate: LessThanOrEqual(date),
        endDate: MoreThanOrEqual(date),
      },
      order: { startDate: 'ASC' },
    });
    if (leave) return off(leave.type);

    const slot = await this.schedules.findOneBy({
      staffMemberId: member.id,
      dayOfWeek: isoWeekday(date),
      isActive: true,
    });
    if (!slot) return off('NOT_SCHEDULED');

    return {
      working: true,
      date,
      start: toHHmm(slot.startTime),
      end: toHHmm(slot.endTime),
      slotMinutes: slot.slotMinutes,
      doctorName: `${member.firstName} ${member.lastName}`,
      departmentId: member.department?.id ?? null,
      departmentName: member.department?.name ?? null,
      departmentCode: member.department?.code ?? null,
    };
  }
}
