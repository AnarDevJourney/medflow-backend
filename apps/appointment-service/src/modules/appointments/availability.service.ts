import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { AppException, ErrorCode } from '@medflow/common';
import { DoctorDay, StaffClient, WorkingDay } from './clients/staff.client';
import {
  addDays,
  clinicDate,
  clinicInstant,
  clinicTime,
  clinicToday,
  fromMinutes,
  MAX_DAYS_AHEAD,
  toMinutes,
} from './clinic-time';
import { AvailabilityQueryDto } from './dto/availability-query.dto';
import { ACTIVE_STATUSES, Appointment } from './entities/appointment.entity';

// Why a slot cannot be booked: already started, the doctor is booked, or
// the chosen patient is booked with someone else at that time
export type SlotBlock = 'PAST' | 'TAKEN' | 'PATIENT_BUSY';

export interface Slot {
  startsAt: string;
  endsAt: string;
  available: boolean;
  reason?: SlotBlock;
}

// A day the doctor can be booked: works, and belongs to a department
// (appointments.department_id is required)
export interface BookableDay extends WorkingDay {
  departmentId: string;
  departmentName: string;
  departmentCode: string;
}

export type Availability =
  | {
      working: true;
      date: string;
      doctorName: string;
      departmentId: string;
      departmentName: string;
      departmentCode: string;
      start: string;
      end: string;
      slotMinutes: number;
      slots: Slot[];
    }
  // staff-service reasons (VACATION, NOT_SCHEDULED, …) + NO_DEPARTMENT
  | { working: false; date: string; reason: string };

// Readable text for a day the doctor cannot be booked
const NOT_WORKING_TEXT: Record<string, string> = {
  NOT_A_DOCTOR: 'This staff member is not a doctor',
  DEACTIVATED: 'This doctor is deactivated',
  VACATION: 'The doctor is on vacation that day',
  SICK_LEAVE: 'The doctor is on sick leave that day',
  TRAINING: 'The doctor is at a training that day',
  DAY_OFF: 'The doctor has a day off that day',
  NOT_SCHEDULED: 'The doctor does not work on that day',
  NO_DEPARTMENT: 'The doctor is not assigned to a department',
};

const rule = (message: string, details: Record<string, unknown>) =>
  new AppException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    ErrorCode.BUSINESS_RULE,
    message,
    details,
  );

const doctorNotFound = () =>
  new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    'Doctor not found',
    {
      field: 'doctorId',
    },
  );

// Slots of one doctor day (DOC 6.2): the weekly schedule cut into
// slotMinutes pieces in clinic time, minus booked and already-started ones
@Injectable()
export class AvailabilityService {
  constructor(
    private readonly staff: StaffClient,
    @InjectRepository(Appointment)
    private readonly appointments: Repository<Appointment>,
  ) {}

  async availability(query: AvailabilityQueryDto): Promise<Availability> {
    const { date } = query;
    assertWithinRange(date, 'date');

    const day = await this.staff.doctorDay(query.doctorId, date);
    if (!day) throw doctorNotFound();
    const bookable = toBookable(day);
    if (!bookable.ok) return { working: false, date, reason: bookable.reason };

    const slots = slotsOf(bookable.day);
    const dayStart = clinicInstant(date, '00:00');
    const dayEnd = clinicInstant(addDays(date, 1), '00:00');

    // Active appointments of the doctor (and of the patient, if asked) that
    // touch the day
    const qb = this.appointments
      .createQueryBuilder('a')
      .select(['a.doctorId', 'a.patientId', 'a.startsAt', 'a.endsAt'])
      .where('a.status IN (:...active)', { active: ACTIVE_STATUSES })
      .andWhere('a.startsAt < :dayEnd AND a.endsAt > :dayStart', {
        dayStart,
        dayEnd,
      })
      .andWhere(
        new Brackets((w) => {
          w.where('a.doctorId = :doctorId', { doctorId: query.doctorId });
          if (query.patientId) {
            w.orWhere('a.patientId = :patientId', {
              patientId: query.patientId,
            });
          }
        }),
      );
    const booked = await qb.getMany();
    const now = Date.now();

    return {
      working: true,
      date,
      doctorName: bookable.day.doctorName,
      departmentId: bookable.day.departmentId,
      departmentName: bookable.day.departmentName,
      departmentCode: bookable.day.departmentCode,
      start: bookable.day.start,
      end: bookable.day.end,
      slotMinutes: bookable.day.slotMinutes,
      slots: slots.map(({ start, end }) => {
        const overlapping = booked.filter(
          (a) => a.startsAt < end && a.endsAt > start,
        );
        let reason: SlotBlock | undefined;
        if (start.getTime() <= now) reason = 'PAST';
        else if (overlapping.some((a) => a.doctorId === query.doctorId)) {
          reason = 'TAKEN';
        } else if (overlapping.length) reason = 'PATIENT_BUSY';
        return {
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
          available: !reason,
          ...(reason ? { reason } : {}),
        };
      }),
    };
  }

  // Booking / rescheduling rules for one start time: in the future, within
  // MAX_DAYS_AHEAD, the doctor works that day and the time is a slot of the
  // schedule. Returns the day (names, department, slot length to snapshot).
  async assertBookable(doctorId: string, startsAt: Date): Promise<BookableDay> {
    if (startsAt.getSeconds() !== 0 || startsAt.getMilliseconds() !== 0) {
      throw rule('The time is not a slot of the doctor’s schedule', {
        field: 'startsAt',
      });
    }
    if (startsAt.getTime() <= Date.now()) {
      throw rule('The appointment time must be in the future', {
        field: 'startsAt',
      });
    }
    const date = clinicDate(startsAt);
    assertWithinRange(date, 'startsAt');

    const day = await this.staff.doctorDay(doctorId, date);
    if (!day) throw doctorNotFound();
    const bookable = toBookable(day);
    if (!bookable.ok) {
      throw rule(
        NOT_WORKING_TEXT[bookable.reason] ??
          'The doctor cannot be booked that day',
        {
          field: 'startsAt',
          reason: bookable.reason,
        },
      );
    }

    const minute = toMinutes(clinicTime(startsAt));
    const start = toMinutes(bookable.day.start);
    const end = toMinutes(bookable.day.end);
    const { slotMinutes } = bookable.day;
    if (
      minute < start ||
      minute + slotMinutes > end ||
      (minute - start) % slotMinutes !== 0
    ) {
      throw rule('The time is not a slot of the doctor’s schedule', {
        field: 'startsAt',
        reason: 'NOT_A_SLOT',
      });
    }
    return bookable.day;
  }
}

function toBookable(
  day: DoctorDay,
): { ok: true; day: BookableDay } | { ok: false; reason: string } {
  if (!day.working) return { ok: false, reason: day.reason };
  if (!day.departmentId || !day.departmentName || !day.departmentCode) {
    return { ok: false, reason: 'NO_DEPARTMENT' };
  }
  return {
    ok: true,
    day: {
      ...day,
      departmentId: day.departmentId,
      departmentName: day.departmentName,
      departmentCode: day.departmentCode,
    },
  };
}

// 09:00–17:00 by 30 → 09:00, 09:30 … 16:30 (a last piece shorter than a
// slot is not offered)
function slotsOf(day: BookableDay): { start: Date; end: Date }[] {
  const slots: { start: Date; end: Date }[] = [];
  const end = toMinutes(day.end);
  for (
    let m = toMinutes(day.start);
    m + day.slotMinutes <= end;
    m += day.slotMinutes
  ) {
    slots.push({
      start: clinicInstant(day.date, fromMinutes(m)),
      end: clinicInstant(day.date, fromMinutes(m + day.slotMinutes)),
    });
  }
  return slots;
}

// Booking is open up to MAX_DAYS_AHEAD days ahead
function assertWithinRange(date: string, field: string): void {
  if (date > addDays(clinicToday(), MAX_DAYS_AHEAD)) {
    throw rule(
      `Appointments can be booked at most ${MAX_DAYS_AHEAD} days ahead`,
      { field, reason: 'TOO_FAR_AHEAD', maxDaysAhead: MAX_DAYS_AHEAD },
    );
  }
}
