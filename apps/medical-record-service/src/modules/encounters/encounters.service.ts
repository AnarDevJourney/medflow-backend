import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { AppException, ErrorCode } from '@medflow/common';
import type { CurrentUserData } from '@medflow/common';
import { RecordEvents } from '@medflow/contracts';
import { OutboxService } from '@medflow/kafka';
import { AppointmentClient } from '../../clients/appointment.client';
import { StartEncounterDto, UpdateEncounterDto } from './dto/encounter.dto';
import {
  AGGREGATE,
  assertDoctor,
  lockedOpenOwn,
  notFound,
} from './encounter-access';
import { EncounterDetailService } from './encounter-detail.service';
import {
  EncounterDetailResponse,
  toEncounterPayload,
} from './encounter.mapper';
import { Encounter, EncounterStatus } from './entities/encounter.entity';

const NOTE_FIELDS = [
  'chiefComplaint',
  'examinationNotes',
  'treatmentPlan',
  'followUpInDays',
] as const;

// 23505 on uq_encounters_appointment: a parallel "Start visit" won
function isDuplicateStart(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driver = error.driverError as { code?: string; constraint?: string };
  return (
    driver.code === '23505' && driver.constraint === 'uq_encounters_appointment'
  );
}

@Injectable()
export class EncountersService {
  private readonly logger = new Logger(EncountersService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Encounter)
    private readonly encounters: Repository<Encounter>,
    private readonly outbox: OutboxService,
    private readonly appointmentsApi: AppointmentClient,
    private readonly detail: EncounterDetailService,
  ) {}

  // DOC 6.3: the appointment must be CHECKED_IN and the caller its doctor.
  // Pressing it again (double click, second tab) returns the visit already
  // open for that appointment instead of an error.
  async start(
    dto: StartEncounterDto,
    actor: CurrentUserData,
  ): Promise<{ encounter: EncounterDetailResponse; created: boolean }> {
    const existing = await this.encounters.findOneBy({
      appointmentId: dto.appointmentId,
    });
    if (existing) {
      assertDoctor(existing.doctorId, actor, 'open this visit');
      return { encounter: await this.detail.of(existing), created: false };
    }

    const appointment = await this.appointmentsApi.findOne(dto.appointmentId);
    if (!appointment) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Appointment not found',
        { field: 'appointmentId' },
      );
    }
    assertDoctor(appointment.doctorId, actor, 'start this visit');
    if (appointment.status !== 'CHECKED_IN') {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_STATUS,
        `A visit can only start for a checked-in patient (appointment is ${appointment.status})`,
        { status: appointment.status },
      );
    }

    try {
      const saved = await this.dataSource.transaction(async (em) => {
        const row = await em.save(
          em.create(Encounter, {
            appointmentId: appointment.id,
            patientId: appointment.patientId,
            doctorId: appointment.doctorId,
            departmentId: appointment.departmentId,
            patientName: appointment.patientName,
            patientMrn: appointment.patientMrn,
            patientEmail: appointment.patientEmail,
            doctorName: appointment.doctorName,
            departmentName: appointment.departmentName,
            departmentCode: appointment.departmentCode,
            appointmentType: appointment.type,
            startedAt: new Date(),
          }),
        );
        await this.outbox.add(em, {
          eventType: RecordEvents.ENCOUNTER_STARTED,
          aggregateType: AGGREGATE,
          aggregateId: row.id,
          actor,
          payload: toEncounterPayload(row),
        });
        return row;
      });
      return { encounter: await this.detail.of(saved), created: true };
    } catch (error) {
      if (!isDuplicateStart(error)) throw error;
      const winner = await this.encounters.findOneByOrFail({
        appointmentId: dto.appointmentId,
      });
      return { encounter: await this.detail.of(winner), created: false };
    }
  }

  async findOne(id: string): Promise<EncounterDetailResponse> {
    const row = await this.encounters.findOneBy({ id });
    if (!row) throw notFound();
    return this.detail.of(row);
  }

  // The visit's own doctor, while it is open. Only changed fields are
  // written; notes are not events (they are clinical and change constantly).
  async update(
    id: string,
    dto: UpdateEncounterDto,
    actor: CurrentUserData,
  ): Promise<EncounterDetailResponse> {
    return this.dataSource.transaction(async (em) => {
      const row = await lockedOpenOwn(em, id, actor, 'edit');
      let changed = false;
      for (const field of NOTE_FIELDS) {
        const value = dto[field];
        if (value === undefined || value === row[field]) continue;
        (row as unknown as Record<string, unknown>)[field] = value;
        changed = true;
      }
      return this.detail.of(changed ? await em.save(row) : row, em);
    });
  }

  // DOC 6.3: a chief complaint and exactly one PRIMARY diagnosis (the
  // partial unique index allows at most one). Closed = read-only;
  // encounter.closed → appointment COMPLETED, billing DRAFT invoice.
  async close(
    id: string,
    actor: CurrentUserData,
  ): Promise<EncounterDetailResponse> {
    const saved = await this.dataSource.transaction(async (em) => {
      const row = await lockedOpenOwn(em, id, actor, 'close');
      if (!row.chiefComplaint) {
        throw closeRule(
          'Write the chief complaint before closing the visit',
          'CHIEF_COMPLAINT_REQUIRED',
          'chiefComplaint',
        );
      }
      const [{ primary }] = await em.query<{ primary: number }[]>(
        `SELECT count(*)::int AS primary FROM diagnoses
         WHERE encounter_id = $1 AND type = 'PRIMARY'`,
        [row.id],
      );
      if (primary !== 1) {
        throw closeRule(
          'Add the primary diagnosis before closing the visit',
          'PRIMARY_DIAGNOSIS_REQUIRED',
          'diagnoses',
        );
      }
      const labs = await em.query<{ test_code: string }[]>(
        `SELECT test_code FROM lab_orders
         WHERE encounter_id = $1 AND status <> 'CANCELLED'
         ORDER BY created_at`,
        [row.id],
      );

      row.status = EncounterStatus.CLOSED;
      row.closedAt = new Date();
      const updated = await em.save(row);
      await this.outbox.add(em, {
        eventType: RecordEvents.ENCOUNTER_CLOSED,
        aggregateType: AGGREGATE,
        aggregateId: updated.id,
        actor,
        payload: {
          ...toEncounterPayload(updated),
          patientEmail: updated.patientEmail,
          closedAt: updated.closedAt!.toISOString(),
          labTestCodes: labs.map((l) => l.test_code),
          followUpInDays: updated.followUpInDays,
        },
      });
      return updated;
    });
    this.logger.log(`Visit ${saved.id} closed`);
    return this.detail.of(saved);
  }
}

const closeRule = (msg: string, reason: string, field: string) =>
  new AppException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    ErrorCode.BUSINESS_RULE,
    msg,
    { reason, field },
  );
