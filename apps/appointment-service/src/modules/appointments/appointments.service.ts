import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import {
  AppException,
  CurrentUserData,
  ErrorCode,
  likePattern,
  Paginated,
  paginated,
  parseSort,
  Role,
  skipOf,
} from '@medflow/common';
import { AppointmentEvents } from '@medflow/contracts';
import { OutboxService } from '@medflow/kafka';
import {
  AppointmentResponse,
  toAppointmentPayload,
  toAppointmentResponse,
} from './appointment.mapper';
import { AvailabilityService } from './availability.service';
import { PatientClient } from './clients/patient.client';
import { addDays, clinicInstant } from './clinic-time';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import {
  APPOINTMENT_SORT_FIELDS,
  ListAppointmentsQueryDto,
} from './dto/list-appointments-query.dto';
import { Appointment, AppointmentType } from './entities/appointment.entity';

const AGGREGATE = 'APPOINTMENT';

const SORT_COLUMNS: Record<(typeof APPOINTMENT_SORT_FIELDS)[number], string> = {
  createdAt: 'a.createdAt',
  startsAt: 'a.startsAt',
};

const notFound = () =>
  new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    'Appointment not found',
  );

// Which exclusion constraint fired (23P01): the doctor's or the patient's
// time was taken between the availability check and the insert
function overlapOf(error: unknown): 'DOCTOR' | 'PATIENT' | null {
  if (!(error instanceof QueryFailedError)) return null;
  const driver = error.driverError as { code?: string; constraint?: string };
  if (driver.code !== '23P01') return null;
  return driver.constraint === 'excl_appointments_patient_overlap'
    ? 'PATIENT'
    : 'DOCTOR';
}

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Appointment)
    private readonly appointments: Repository<Appointment>,
    private readonly outbox: OutboxService,
    private readonly availability: AvailabilityService,
    private readonly patients: PatientClient,
  ) {}

  // Filters on the snapshots only — no calls to other services
  async list(
    query: ListAppointmentsQueryDto,
    viewer: CurrentUserData,
  ): Promise<Paginated<AppointmentResponse>> {
    const qb = this.appointments.createQueryBuilder('a');

    // A doctor's list is their own day by default (DOC 8.5); they may look
    // at a colleague's or everyone's on purpose
    const doctorId =
      query.doctorId ??
      (viewer.role === Role.DOCTOR && !query.allDoctors && !query.patientId
        ? viewer.id
        : undefined);
    if (doctorId) qb.andWhere('a.doctorId = :doctorId', { doctorId });
    if (query.departmentId) {
      qb.andWhere('a.departmentId = :departmentId', {
        departmentId: query.departmentId,
      });
    }
    if (query.patientId) {
      qb.andWhere('a.patientId = :patientId', { patientId: query.patientId });
    }
    if (query.status) {
      qb.andWhere('a.status = :status', { status: query.status });
    }
    // Clinic calendar days, both ends inclusive
    if (query.from) {
      qb.andWhere('a.startsAt >= :from', {
        from: clinicInstant(query.from, '00:00'),
      });
    }
    if (query.to) {
      qb.andWhere('a.startsAt < :to', {
        to: clinicInstant(addDays(query.to, 1), '00:00'),
      });
    }
    if (query.search) {
      qb.andWhere('(a.patientName ILIKE :like OR a.patientMrn ILIKE :like)', {
        like: likePattern(query.search),
      });
    }

    // Newest bookings first by default, like every list in the app
    const sort = parseSort(query.sort, APPOINTMENT_SORT_FIELDS, {
      createdAt: 'DESC',
    });
    for (const [field, direction] of Object.entries(sort)) {
      qb.addOrderBy(
        SORT_COLUMNS[field as keyof typeof SORT_COLUMNS],
        direction,
      );
    }
    qb.addOrderBy('a.id', 'ASC'); // stable pages when sort values tie

    const [items, total] = await qb
      .skip(skipOf(query))
      .take(query.limit)
      .getManyAndCount();
    return paginated(items.map(toAppointmentResponse), total, query);
  }

  async findOne(id: string): Promise<AppointmentResponse> {
    const row = await this.appointments.findOneBy({ id });
    if (!row) throw notFound();
    return toAppointmentResponse(row);
  }

  // DOC 6.2: rules → doctor day + patient in parallel → insert with
  // snapshots + appointment.created in one transaction. Two desks booking
  // the same slot: the exclusion constraint lets one through, the other
  // gets 409 SLOT_TAKEN.
  async create(
    dto: CreateAppointmentDto,
    actor: CurrentUserData,
  ): Promise<AppointmentResponse> {
    const startsAt = new Date(dto.startsAt);
    const [day, patient] = await Promise.all([
      this.availability.assertBookable(dto.doctorId, startsAt),
      this.patients.summary(dto.patientId),
    ]);
    if (!patient) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Patient not found',
        { field: 'patientId' },
      );
    }
    if (!patient.isActive) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_STATUS,
        'An inactive patient record cannot be booked',
        { field: 'patientId' },
      );
    }

    try {
      const saved = await this.dataSource.transaction(async (em) => {
        const row = await em.save(
          em.create(Appointment, {
            patientId: patient.id,
            doctorId: dto.doctorId,
            departmentId: day.departmentId,
            patientName: `${patient.firstName} ${patient.lastName}`,
            patientMrn: patient.mrn,
            patientPhone: patient.phone,
            patientEmail: patient.email,
            doctorName: day.doctorName,
            departmentName: day.departmentName,
            departmentCode: day.departmentCode,
            startsAt,
            endsAt: new Date(startsAt.getTime() + day.slotMinutes * 60_000),
            type: dto.type ?? AppointmentType.CONSULTATION,
            reason: dto.reason ?? null,
            notes: dto.notes ?? null,
            createdBy: actor.id,
          }),
        );
        await this.outbox.add(em, {
          eventType: AppointmentEvents.APPOINTMENT_CREATED,
          aggregateType: AGGREGATE,
          aggregateId: row.id,
          actor,
          payload: toAppointmentPayload(row),
        });
        return row;
      });
      return toAppointmentResponse(saved);
    } catch (error) {
      const overlap = overlapOf(error);
      if (!overlap) throw error;
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.SLOT_TAKEN,
        overlap === 'DOCTOR'
          ? 'This time slot was just taken'
          : 'The patient already has an appointment at this time',
        { field: 'startsAt', conflict: overlap },
      );
    }
  }
}
