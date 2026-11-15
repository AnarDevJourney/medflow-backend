import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  QueryFailedError,
  Repository,
} from 'typeorm';
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
import { addDays, clinicDate, clinicInstant, clinicToday } from './clinic-time';
import {
  CancelAppointmentDto,
  RescheduleAppointmentDto,
  TodayQueryDto,
  UpdateAppointmentDto,
} from './dto/change-appointment.dto';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import {
  APPOINTMENT_SORT_FIELDS,
  ListAppointmentsQueryDto,
} from './dto/list-appointments-query.dto';
import {
  Appointment,
  AppointmentStatus,
  AppointmentType,
} from './entities/appointment.entity';

const AGGREGATE = 'APPOINTMENT';

const SORT_COLUMNS: Record<(typeof APPOINTMENT_SORT_FIELDS)[number], string> = {
  createdAt: 'a.createdAt',
  startsAt: 'a.startsAt',
};

const EDITABLE_FIELDS = ['type', 'reason', 'notes'] as const;

// "Cannot cancel an appointment that is IN_PROGRESS" (DOC 6.2)
function assertStatus(
  row: Appointment,
  allowed: AppointmentStatus[],
  action: string,
): void {
  if (!allowed.includes(row.status)) {
    throw new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.INVALID_STATUS,
      `Cannot ${action} an appointment that is ${row.status}`,
      { status: row.status },
    );
  }
}

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
            createdByName: actor.name,
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
      throw toSlotTaken(error);
    }
  }

  // Today's appointments in time order, no paging (DOC 8.5). A doctor gets
  // their own; the front desk and nurses everyone's, or one department's.
  async today(
    query: TodayQueryDto,
    viewer: CurrentUserData,
  ): Promise<AppointmentResponse[]> {
    const day = clinicToday();
    const qb = this.appointments
      .createQueryBuilder('a')
      .where('a.startsAt >= :from AND a.startsAt < :to', {
        from: clinicInstant(day, '00:00'),
        to: clinicInstant(addDays(day, 1), '00:00'),
      });
    const doctorId =
      query.doctorId ?? (viewer.role === Role.DOCTOR ? viewer.id : undefined);
    if (doctorId) qb.andWhere('a.doctorId = :doctorId', { doctorId });
    if (query.departmentId) {
      qb.andWhere('a.departmentId = :departmentId', {
        departmentId: query.departmentId,
      });
    }
    const rows = await qb
      .orderBy('a.startsAt', 'ASC')
      .addOrderBy('a.doctorName', 'ASC')
      .take(500)
      .getMany();
    return rows.map(toAppointmentResponse);
  }

  // The patient arrived (DOC 6.2): only on the appointment's day
  async checkIn(
    id: string,
    actor: CurrentUserData,
  ): Promise<AppointmentResponse> {
    const saved = await this.dataSource.transaction(async (em) => {
      const row = await lockedRow(em, id);
      assertStatus(row, [AppointmentStatus.SCHEDULED], 'check in');
      if (clinicDate(row.startsAt) !== clinicToday()) {
        throw new AppException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          ErrorCode.BUSINESS_RULE,
          'Check-in is only possible on the day of the appointment',
          { reason: 'NOT_APPOINTMENT_DAY' },
        );
      }
      row.status = AppointmentStatus.CHECKED_IN;
      row.checkedInAt = new Date();
      row.checkedInBy = actor.id;
      row.checkedInByName = actor.name;
      const updated = await em.save(row);
      await this.outbox.add(em, {
        eventType: AppointmentEvents.APPOINTMENT_CHECKED_IN,
        aggregateType: AGGREGATE,
        aggregateId: updated.id,
        actor,
        payload: toAppointmentPayload(updated),
      });
      return updated;
    });
    return toAppointmentResponse(saved);
  }

  // Never deleted: CANCELLED with a reason, and the slot is free again
  // (the exclusion constraints skip cancelled rows). A checked-in patient
  // who left before the visit can be cancelled too.
  async cancel(
    id: string,
    dto: CancelAppointmentDto,
    actor: CurrentUserData,
  ): Promise<AppointmentResponse> {
    const saved = await this.dataSource.transaction(async (em) => {
      const row = await lockedRow(em, id);
      assertStatus(
        row,
        [AppointmentStatus.SCHEDULED, AppointmentStatus.CHECKED_IN],
        'cancel',
      );
      const previousStatus = row.status as 'SCHEDULED' | 'CHECKED_IN';
      row.status = AppointmentStatus.CANCELLED;
      row.cancelledAt = new Date();
      row.cancelledBy = actor.id;
      row.cancelledByName = actor.name;
      row.cancellationReason = dto.reason;
      const updated = await em.save(row);
      await this.outbox.add(em, {
        eventType: AppointmentEvents.APPOINTMENT_CANCELLED,
        aggregateType: AGGREGATE,
        aggregateId: updated.id,
        actor,
        payload: {
          ...toAppointmentPayload(updated),
          reason: dto.reason,
          previousStatus,
        },
      });
      return updated;
    });
    return toAppointmentResponse(saved);
  }

  // Another time and / or doctor, with every booking rule checked again.
  // The schedule is asked first (outside the row lock); the exclusion
  // constraints still guard the new slot.
  async reschedule(
    id: string,
    dto: RescheduleAppointmentDto,
    actor: CurrentUserData,
  ): Promise<AppointmentResponse> {
    const current = await this.appointments.findOneBy({ id });
    if (!current) throw notFound();
    assertStatus(current, [AppointmentStatus.SCHEDULED], 'reschedule');
    const doctorId = dto.doctorId ?? current.doctorId;
    const startsAt = new Date(dto.startsAt);
    if (
      doctorId === current.doctorId &&
      startsAt.getTime() === current.startsAt.getTime()
    ) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
        'The appointment is already at this time with this doctor',
        { field: 'startsAt' },
      );
    }
    const day = await this.availability.assertBookable(doctorId, startsAt);

    try {
      const saved = await this.dataSource.transaction(async (em) => {
        const row = await lockedRow(em, id);
        assertStatus(row, [AppointmentStatus.SCHEDULED], 'reschedule');
        const previous = {
          startsAt: row.startsAt.toISOString(),
          endsAt: row.endsAt.toISOString(),
          doctorId: row.doctorId,
          doctorName: row.doctorName,
          departmentId: row.departmentId,
          departmentName: row.departmentName,
        };
        row.doctorId = doctorId;
        row.doctorName = day.doctorName;
        row.departmentId = day.departmentId;
        row.departmentName = day.departmentName;
        row.departmentCode = day.departmentCode;
        row.startsAt = startsAt;
        row.endsAt = new Date(startsAt.getTime() + day.slotMinutes * 60_000);
        row.updatedBy = actor.id;
        row.updatedByName = actor.name;
        const updated = await em.save(row);
        await this.outbox.add(em, {
          eventType: AppointmentEvents.APPOINTMENT_RESCHEDULED,
          aggregateType: AGGREGATE,
          aggregateId: updated.id,
          actor,
          payload: { ...toAppointmentPayload(updated), previous },
        });
        return updated;
      });
      return toAppointmentResponse(saved);
    } catch (error) {
      throw toSlotTaken(error);
    }
  }

  // Visit type, reason, notes. Only what really changed is saved and named
  // in the event; nothing changed → no event.
  async update(
    id: string,
    dto: UpdateAppointmentDto,
    actor: CurrentUserData,
  ): Promise<AppointmentResponse> {
    if ((dto as { type?: unknown }).type === null) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        'Validation failed',
        [{ field: 'type', errors: ['type cannot be empty'] }],
      );
    }
    const saved = await this.dataSource.transaction(async (em) => {
      const row = await lockedRow(em, id);
      assertStatus(
        row,
        [AppointmentStatus.SCHEDULED, AppointmentStatus.CHECKED_IN],
        'edit',
      );
      const changedFields = EDITABLE_FIELDS.filter(
        (field) => dto[field] !== undefined && dto[field] !== row[field],
      );
      if (changedFields.length === 0) return row;
      for (const field of changedFields) {
        (row as unknown as Record<string, unknown>)[field] = dto[field];
      }
      row.updatedBy = actor.id;
      row.updatedByName = actor.name;
      const updated = await em.save(row);
      await this.outbox.add(em, {
        eventType: AppointmentEvents.APPOINTMENT_UPDATED,
        aggregateType: AGGREGATE,
        aggregateId: updated.id,
        actor,
        payload: { ...toAppointmentPayload(updated), changedFields },
      });
      return updated;
    });
    return toAppointmentResponse(saved);
  }
}

// The row, locked until the transaction ends: parallel changes of one
// appointment run one after the other and see each other's result
async function lockedRow(em: EntityManager, id: string): Promise<Appointment> {
  const row = await em.findOne(Appointment, {
    where: { id },
    lock: { mode: 'pessimistic_write' },
  });
  if (!row) throw notFound();
  return row;
}

// 23P01 from an exclusion constraint → 409 SLOT_TAKEN naming whose time
// was taken; anything else is rethrown as it is
function toSlotTaken(error: unknown): unknown {
  const overlap = overlapOf(error);
  if (!overlap) return error;
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.SLOT_TAKEN,
    overlap === 'DOCTOR'
      ? 'This time slot was just taken'
      : 'The patient already has an appointment at this time',
    { field: 'startsAt', conflict: overlap },
  );
}
