import type { AppointmentPayload, DomainEvent } from '@medflow/contracts';
import {
  NotificationDraft,
  NotificationTemplates,
} from './notification-template';

// appointment.events → the doctor's in-app notifications (DOC 5.6, user
// decision 7.4: doctors only — the front desk sees the live calendar).
// Nobody is told about their own action. Titles / messages are the English
// fallback; the UI translates by type with `params`.

const clinicTime = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Baku',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));

const clinicDay = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baku' }).format(
    new Date(iso),
  );

// The day view of that date with the appointment's drawer open
export const appointmentLink = (p: AppointmentPayload) =>
  `/appointments?view=day&date=${clinicDay(p.startsAt)}&open=${p.appointmentId}`;

const paramsOf = (p: AppointmentPayload) => ({
  name: p.patientName,
  mrn: p.patientMrn,
  doctor: p.doctorName,
  startsAt: p.startsAt,
});

function draft(
  event: DomainEvent,
  p: AppointmentPayload,
  recipientId: string,
  fields: Omit<NotificationDraft, 'recipientId' | 'entityType' | 'entityId'>,
): NotificationDraft[] {
  if (event.actor?.id === recipientId) return []; // their own action
  return [
    {
      recipientId,
      entityType: 'APPOINTMENT',
      entityId: p.appointmentId,
      link: appointmentLink(p),
      ...fields,
      params: { ...paramsOf(p), ...fields.params },
    },
  ];
}

export const appointmentNotifications: NotificationTemplates = {
  'appointment.created': (event) => {
    const p = event.payload;
    return draft(event, p, p.doctorId, {
      type: 'APPOINTMENT_BOOKED',
      title: 'New appointment',
      message: `${p.patientName} (${p.patientMrn}) is booked for ${clinicTime(p.startsAt)}`,
    });
  },

  // Same doctor: the time moved. Another doctor: the old one loses it, the
  // new one gets it.
  'appointment.rescheduled': (event) => {
    const p = event.payload;
    if (p.previous.doctorId === p.doctorId) {
      return draft(event, p, p.doctorId, {
        type: 'APPOINTMENT_RESCHEDULED',
        title: 'Appointment moved',
        message: `${p.patientName} (${p.patientMrn}): ${clinicTime(p.previous.startsAt)} → ${clinicTime(p.startsAt)}`,
        params: { previousStartsAt: p.previous.startsAt },
      });
    }
    return [
      ...draft(event, p, p.previous.doctorId, {
        type: 'APPOINTMENT_MOVED_AWAY',
        title: 'Appointment moved to another doctor',
        message: `${p.patientName} (${p.patientMrn}), ${clinicTime(p.previous.startsAt)}, now with ${p.doctorName}`,
        params: { previousStartsAt: p.previous.startsAt },
      }),
      ...draft(event, p, p.doctorId, {
        type: 'APPOINTMENT_BOOKED',
        title: 'New appointment',
        message: `${p.patientName} (${p.patientMrn}) is booked for ${clinicTime(p.startsAt)}`,
      }),
    ];
  },

  'appointment.cancelled': (event) => {
    const p = event.payload;
    return draft(event, p, p.doctorId, {
      type: 'APPOINTMENT_CANCELLED',
      title: 'Appointment cancelled',
      message: `${p.patientName} (${p.patientMrn}), ${clinicTime(p.startsAt)}`,
    });
  },

  // Real time: the doctor sees at once that the patient is waiting
  'appointment.checked_in': (event) => {
    const p = event.payload;
    return draft(event, p, p.doctorId, {
      type: 'APPOINTMENT_CHECKED_IN',
      title: 'Patient arrived',
      message: `${p.patientName} (${p.patientMrn}) checked in for ${clinicTime(p.startsAt)}`,
      isUrgent: true,
    });
  },

  'appointment.no_show': (event) => {
    const p = event.payload;
    return draft(event, p, p.doctorId, {
      type: 'APPOINTMENT_NO_SHOW',
      title: 'Patient did not come',
      message: `${p.patientName} (${p.patientMrn}), ${clinicTime(p.startsAt)}`,
    });
  },
};
