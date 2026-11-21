import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import type {
  EncounterClosedPayload,
  EncounterPayload,
} from '@medflow/contracts';
import { Appointment, AppointmentStatus } from './entities/appointment.entity';

// record.events → appointment status (DOC 6.2): the visit started →
// IN_PROGRESS + encounter_id, the visit closed → COMPLETED. No events of
// our own — encounter.started / closed are already in the history.
@Injectable()
export class EncounterSyncService {
  private readonly logger = new Logger(EncounterSyncService.name);

  async onStarted(p: EncounterPayload, em: EntityManager): Promise<void> {
    const row = await locked(em, p.appointmentId);
    if (!row) {
      this.logger.warn(
        `encounter.started for unknown appointment ${p.appointmentId}`,
      );
      return;
    }
    if (
      row.status === AppointmentStatus.IN_PROGRESS &&
      row.encounterId === p.encounterId
    ) {
      return;
    }
    if (row.status !== AppointmentStatus.CHECKED_IN) {
      // e.g. cancelled between the start check and this event — the visit
      // itself stays valid in record-service
      this.logger.warn(
        `encounter.started: appointment ${row.id} is ${row.status}, left as it is`,
      );
      return;
    }
    row.status = AppointmentStatus.IN_PROGRESS;
    row.encounterId = p.encounterId;
    row.startedAt = new Date(p.startedAt);
    await em.save(row);
  }

  async onClosed(p: EncounterClosedPayload, em: EntityManager): Promise<void> {
    const row = await locked(em, p.appointmentId);
    if (!row) {
      this.logger.warn(
        `encounter.closed for unknown appointment ${p.appointmentId}`,
      );
      return;
    }
    if (row.status === AppointmentStatus.COMPLETED) return;
    // Both events share the encounter key (one partition, in order), so
    // CHECKED_IN here means the start was skipped above — finish anyway
    if (
      row.status !== AppointmentStatus.IN_PROGRESS &&
      row.status !== AppointmentStatus.CHECKED_IN
    ) {
      this.logger.warn(
        `encounter.closed: appointment ${row.id} is ${row.status}, left as it is`,
      );
      return;
    }
    row.status = AppointmentStatus.COMPLETED;
    row.encounterId = p.encounterId;
    row.startedAt ??= new Date(p.startedAt);
    row.completedAt = new Date(p.closedAt);
    await em.save(row);
  }
}

const locked = (em: EntityManager, id: string) =>
  em.findOne(Appointment, {
    where: { id },
    lock: { mode: 'pessimistic_write' },
  });
