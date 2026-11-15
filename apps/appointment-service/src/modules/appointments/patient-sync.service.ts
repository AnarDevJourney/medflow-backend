import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AppointmentEvents, SYSTEM_CANCEL_REASONS } from '@medflow/contracts';
import type { PatientPayload, PatientUpdatedPayload } from '@medflow/contracts';
import { OutboxService } from '@medflow/kafka';
import { toAppointmentPayload } from './appointment.mapper';
import { Appointment, AppointmentStatus } from './entities/appointment.entity';

// Patient fields copied into appointments
const SNAPSHOT_FIELDS = ['firstName', 'lastName', 'phone', 'email'];

// patient.events → appointments (DOC 5.6). Only future SCHEDULED visits
// change: past ones are a record of what happened.
@Injectable()
export class PatientSyncService {
  constructor(private readonly outbox: OutboxService) {}

  // Name / phone / email changed → refresh the snapshots. No event: the
  // patient's own patient.updated is already in the history.
  async onUpdated(p: PatientUpdatedPayload, em: EntityManager): Promise<void> {
    if (!p.changedFields.some((field) => SNAPSHOT_FIELDS.includes(field))) {
      return;
    }
    await em
      .createQueryBuilder()
      .update(Appointment)
      .set({
        patientName: `${p.firstName} ${p.lastName}`,
        patientPhone: p.phone,
        patientEmail: p.email,
      })
      .where('patient_id = :id', { id: p.patientId })
      .andWhere('status = :status', { status: AppointmentStatus.SCHEDULED })
      .andWhere('starts_at > now()')
      .execute();
  }

  // Duplicate or deceased record: its future visits are cancelled by the
  // system — the slots free up, the doctors are told, the patient is NOT
  // emailed (user decision, phase 7.4)
  async onDeactivated(p: PatientPayload, em: EntityManager): Promise<void> {
    const rows = await em
      .createQueryBuilder(Appointment, 'a')
      .where('a.patientId = :id', { id: p.patientId })
      .andWhere('a.status = :status', { status: AppointmentStatus.SCHEDULED })
      .andWhere('a.startsAt > now()')
      .setLock('pessimistic_write')
      .getMany();
    for (const row of rows) {
      row.status = AppointmentStatus.CANCELLED;
      row.cancelledAt = new Date();
      row.cancelledBy = null;
      row.cancelledByName = null;
      row.cancellationReason = SYSTEM_CANCEL_REASONS.PATIENT_DEACTIVATED;
      await em.save(row);
      await this.outbox.add(em, {
        eventType: AppointmentEvents.APPOINTMENT_CANCELLED,
        aggregateType: 'APPOINTMENT',
        aggregateId: row.id,
        actor: null,
        payload: {
          ...toAppointmentPayload(row),
          reason: SYSTEM_CANCEL_REASONS.PATIENT_DEACTIVATED,
          previousStatus: 'SCHEDULED',
          notifyPatient: false,
        },
      });
    }
  }
}
