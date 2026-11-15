import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppException, ErrorCode } from '@medflow/common';
import {
  AppointmentResponse,
  toAppointmentResponse,
} from './appointment.mapper';
import { DoctorDays, StaffClient } from './clients/staff.client';
import { addDays, clinicInstant } from './clinic-time';
import { CalendarQueryDto } from './dto/calendar-query.dto';
import { Appointment, AppointmentStatus } from './entities/appointment.entity';

// Longest range of one calendar request (a week view needs 7)
export const MAX_CALENDAR_DAYS = 14;

export interface CalendarResponse {
  from: string;
  to: string;
  // Doctors who can be booked in the range, each day: hours or why not
  doctors: DoctorDays[];
  appointments: AppointmentResponse[];
}

// Everything a day / week calendar needs in one request: the doctors' days
// from staff-service (one batch call) + the appointments of the range
@Injectable()
export class CalendarService {
  constructor(
    private readonly staff: StaffClient,
    @InjectRepository(Appointment)
    private readonly appointments: Repository<Appointment>,
  ) {}

  async calendar(query: CalendarQueryDto): Promise<CalendarResponse> {
    if (query.to < query.from) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
        'to must not be before from',
        { field: 'to' },
      );
    }
    if (addDays(query.from, MAX_CALENDAR_DAYS - 1) < query.to) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
        `At most ${MAX_CALENDAR_DAYS} days at once`,
        { field: 'to' },
      );
    }

    const qb = this.appointments
      .createQueryBuilder('a')
      .where('a.startsAt >= :from AND a.startsAt < :to', {
        from: clinicInstant(query.from, '00:00'),
        to: clinicInstant(addDays(query.to, 1), '00:00'),
      });
    if (query.doctorId) {
      qb.andWhere('a.doctorId = :doctorId', { doctorId: query.doctorId });
    }
    if (query.departmentId) {
      qb.andWhere('a.departmentId = :departmentId', {
        departmentId: query.departmentId,
      });
    }
    if (!query.includeCancelled) {
      qb.andWhere('a.status <> :cancelled', {
        cancelled: AppointmentStatus.CANCELLED,
      });
    }

    const [doctors, rows] = await Promise.all([
      this.staff.doctorDays(query),
      qb.orderBy('a.startsAt', 'ASC').take(2000).getMany(),
    ]);
    return {
      from: query.from,
      to: query.to,
      doctors,
      appointments: rows.map(toAppointmentResponse),
    };
  }
}
