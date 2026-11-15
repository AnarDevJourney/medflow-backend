import type {
  AppointmentEventPayloads,
  AppointmentPayload,
  DomainEvent,
} from '@medflow/contracts';
import {
  actorName,
  HistoryEntry,
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
// never the patient's contacts or the visit reason (only that it changed).
export const appointmentTemplates: HistoryTemplates<AppointmentEventType> = {
  'appointment.created': (event) =>
    entry(
      event,
      `booked ${who(event.payload)} with ${event.payload.doctorName} at ${event.payload.startsAt}`,
      'appointment.created',
    ),

  'appointment.updated': (event) => {
    const p = event.payload;
    return {
      ...entry(
        event,
        `updated the appointment of ${who(p)}: ${p.changedFields.join(', ')}`,
        'appointment.updated',
        { fields: p.changedFields },
      ),
      metadata: { ...metadataOf(p), changedFields: p.changedFields },
    };
  },

  'appointment.rescheduled': (event) => {
    const p = event.payload;
    const doctorChanged = p.previous.doctorId !== p.doctorId;
    return {
      ...entry(
        event,
        `moved the appointment of ${who(p)} from ${p.previous.startsAt} to ${p.startsAt}` +
          (doctorChanged
            ? ` (${p.previous.doctorName} → ${p.doctorName})`
            : ''),
        doctorChanged
          ? 'appointment.rescheduledDoctor'
          : 'appointment.rescheduled',
        {
          previousStartsAt: p.previous.startsAt,
          previousDoctor: p.previous.doctorName,
        },
      ),
      metadata: {
        ...metadataOf(p),
        previousStartsAt: p.previous.startsAt,
        ...(doctorChanged ? { previousDoctorName: p.previous.doctorName } : {}),
      },
    };
  },

  'appointment.checked_in': (event) =>
    entry(
      event,
      `checked in ${who(event.payload)} for the appointment with ${event.payload.doctorName}`,
      'appointment.checkedIn',
    ),

  'appointment.cancelled': (event) => {
    const p = event.payload;
    return {
      ...entry(
        event,
        `cancelled the appointment of ${who(p)} with ${p.doctorName} at ${p.startsAt}`,
        'appointment.cancelled',
      ),
      metadata: { ...metadataOf(p), cancellationReason: p.reason },
    };
  },
};

const who = (p: AppointmentPayload) => `${p.patientName} (${p.patientMrn})`;

const metadataOf = (p: AppointmentPayload) => ({
  mrn: p.patientMrn,
  doctorName: p.doctorName,
  departmentName: p.departmentName,
  startsAt: p.startsAt,
  appointmentType: p.type,
});

function entry(
  event: DomainEvent<AppointmentEventType>,
  text: string,
  key: string,
  extra: Record<string, string | string[]> = {},
): HistoryEntry {
  const p = event.payload;
  return {
    entityType: APPOINTMENT,
    entityId: p.appointmentId,
    patientId: p.patientId,
    summary: `${actorName(event)} ${text}`,
    message: message(key, {
      actor: actor(event),
      name: p.patientName,
      mrn: p.patientMrn,
      doctor: p.doctorName,
      startsAt: p.startsAt,
      ...extra,
    }),
    metadata: metadataOf(p),
  };
}
