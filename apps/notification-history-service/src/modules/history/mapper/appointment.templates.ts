import type { AppointmentEventPayloads, DomainEvent } from '@medflow/contracts';
import {
  actorName,
  message,
  HistoryEventType,
  HistoryTemplates,
} from './history-template';

const APPOINTMENT = 'APPOINTMENT';
const actor = (event: DomainEvent): string | null => event.actor?.name ?? null;

type AppointmentEventType = Extract<
  HistoryEventType,
  keyof AppointmentEventPayloads
>;

// appointment.events. Entity = the appointment and patientId is set, so the
// rows also show up on the patient timeline. Names, MRN, doctor and time —
// never the patient's contacts or the visit reason.
export const appointmentTemplates: HistoryTemplates<AppointmentEventType> = {
  'appointment.created': (event) => {
    const p = event.payload;
    return {
      entityType: APPOINTMENT,
      entityId: p.appointmentId,
      patientId: p.patientId,
      summary: `${actorName(event)} booked ${p.patientName} (${p.patientMrn}) with ${p.doctorName} at ${p.startsAt}`,
      message: message('appointment.created', {
        actor: actor(event),
        name: p.patientName,
        mrn: p.patientMrn,
        doctor: p.doctorName,
        startsAt: p.startsAt,
      }),
      metadata: {
        mrn: p.patientMrn,
        doctorName: p.doctorName,
        departmentName: p.departmentName,
        startsAt: p.startsAt,
        appointmentType: p.type,
      },
    };
  },
};
