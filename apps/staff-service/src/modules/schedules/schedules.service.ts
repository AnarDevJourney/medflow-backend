import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  AppException,
  CurrentUserData,
  ErrorCode,
  Role,
} from '@medflow/common';
import { StaffEvents } from '@medflow/contracts';
import { OutboxService } from '@medflow/kafka';
import {
  StaffMember,
  StaffStatus,
} from '../staff/entities/staff-member.entity';
import { ReplaceScheduleDto } from './dto/replace-schedule.dto';
import { DoctorSchedule } from './entities/doctor-schedule.entity';
import {
  minutesOf,
  sameDay,
  ScheduleDay,
  ScheduleResponse,
  toScheduleDay,
} from './schedule.mapper';

const AGGREGATE = 'STAFF_MEMBER';

const notFound = () =>
  new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    'Staff member not found',
  );

const rule = (message: string, field: string) =>
  new AppException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    ErrorCode.BUSINESS_RULE,
    message,
    { field },
  );

const byDay = (a: ScheduleDay, b: ScheduleDay) => a.dayOfWeek - b.dayOfWeek;

// Doctors' weekly schedules (DOC 5.6, 8.3). Availability for booking is
// built from these rows (and time off) by GET /internal/doctors/:id/day.
@Injectable()
export class SchedulesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly outbox: OutboxService,
  ) {}

  // schedules.read → anyone's week; schedules.read_own → only one's own.
  // Not a doctor → an empty week (nobody can set one).
  async findOne(
    userId: string,
    viewer: CurrentUserData,
  ): Promise<ScheduleResponse> {
    if (
      !viewer.permissions.includes('schedules.read') &&
      viewer.id !== userId
    ) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'You can only view your own schedule',
      );
    }
    const staff = await this.dataSource.manager.findOneBy(StaffMember, {
      userId,
    });
    if (!staff) throw notFound();
    return {
      userId,
      days: await this.daysOf(staff.id, this.dataSource.manager),
    };
  }

  // Replaces the whole week in one transaction. The staff row is locked, so
  // two saves of one week run one after the other and each event lists
  // what really changed. Nothing changed → no event.
  async replace(
    userId: string,
    dto: ReplaceScheduleDto,
    actor: CurrentUserData,
  ): Promise<ScheduleResponse> {
    const next = this.validWeek(dto);

    const days = await this.dataSource.transaction(async (em) => {
      const staff = await em.findOne(StaffMember, {
        where: { userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!staff) throw notFound();
      if (staff.role !== Role.DOCTOR) {
        throw rule('Only doctors have a weekly schedule', 'role');
      }
      if (staff.status === StaffStatus.DEACTIVATED) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.INVALID_STATUS,
          'The schedule of a deactivated doctor cannot be changed',
        );
      }

      const rows = await em.findBy(DoctorSchedule, {
        staffMemberId: staff.id,
      });
      const current = new Map(rows.map((row) => [row.dayOfWeek, row]));
      const previous = rows.map(toScheduleDay).sort(byDay);
      const wanted = new Map(next.map((day) => [day.dayOfWeek, day]));

      const removed = rows.filter((row) => !wanted.has(row.dayOfWeek));
      const added = next.filter((day) => !current.has(day.dayOfWeek));
      const changed = next.filter((day) => {
        const row = current.get(day.dayOfWeek);
        return row !== undefined && !sameDay(toScheduleDay(row), day);
      });
      const changedDays = [
        ...removed.map((row) => row.dayOfWeek),
        ...added.map((day) => day.dayOfWeek),
        ...changed.map((day) => day.dayOfWeek),
      ].sort((a, b) => a - b);
      if (changedDays.length === 0) return previous;

      if (removed.length > 0) await em.remove(removed);
      for (const day of changed) {
        await em.update(
          DoctorSchedule,
          { id: current.get(day.dayOfWeek)!.id },
          {
            startTime: day.startTime,
            endTime: day.endTime,
            slotMinutes: day.slotMinutes,
          },
        );
      }
      if (added.length > 0) {
        await em.insert(
          DoctorSchedule,
          added.map((day) => ({ ...day, staffMemberId: staff.id })),
        );
      }

      await this.outbox.add(em, {
        eventType: StaffEvents.SCHEDULE_UPDATED,
        aggregateType: AGGREGATE,
        aggregateId: staff.userId,
        actor,
        payload: {
          userId: staff.userId,
          staffMemberId: staff.id,
          firstName: staff.firstName,
          lastName: staff.lastName,
          days: next,
          previousDays: previous,
          changedDays,
        },
      });
      return next;
    });
    return { userId, days };
  }

  private async daysOf(
    staffMemberId: string,
    em: EntityManager,
  ): Promise<ScheduleDay[]> {
    const rows = await em.find(DoctorSchedule, {
      where: { staffMemberId },
      order: { dayOfWeek: 'ASC' },
    });
    return rows.map(toScheduleDay);
  }

  // Rules across fields (the DTO checked each field): one entry per day,
  // end after start, a whole number of slots — booking generates slots
  // from start to end, a half slot at the end would never be bookable.
  private validWeek(dto: ReplaceScheduleDto): ScheduleDay[] {
    const seen = new Set<number>();
    dto.days.forEach((day, index) => {
      if (seen.has(day.dayOfWeek)) {
        throw rule(
          'Each weekday may appear only once',
          `days.${index}.dayOfWeek`,
        );
      }
      seen.add(day.dayOfWeek);
      const length = minutesOf(day.endTime) - minutesOf(day.startTime);
      if (length <= 0) {
        throw rule(
          'The end time must be after the start time',
          `days.${index}.endTime`,
        );
      }
      if (length % day.slotMinutes !== 0) {
        throw rule(
          'The working hours must divide into whole slots',
          `days.${index}.endTime`,
        );
      }
    });
    return dto.days
      .map(({ dayOfWeek, startTime, endTime, slotMinutes }) => ({
        dayOfWeek,
        startTime,
        endTime,
        slotMinutes,
      }))
      .sort(byDay);
  }
}
