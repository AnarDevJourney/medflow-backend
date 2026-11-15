import type { AppointmentPayload } from '@medflow/contracts';
import { EmailDraft, EmailTemplates } from './email-template';

// appointment.events → emails to the patient (DOC 5.6), in Azerbaijani
// (user decision 7.4). Only patients with an email; a system cancellation
// (record deactivated) never emails. Sending after the visit is pointless,
// so every email expires at its start.

const TYPE_AZ: Record<string, string> = {
  CONSULTATION: 'Konsultasiya',
  FOLLOW_UP: 'Təkrar qəbul',
  CHECK_UP: 'Müayinə',
};

const subjectTime = (iso: string) =>
  new Intl.DateTimeFormat('az', {
    timeZone: 'Asia/Baku',
    day: 'numeric',
    month: 'long',
  }).format(new Date(iso)) +
  ', ' +
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Baku',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));

const visitData = (p: AppointmentPayload) => ({
  patientName: p.patientName,
  doctorName: p.doctorName,
  departmentName: p.departmentName,
  startsAt: p.startsAt,
  typeLabel: TYPE_AZ[p.type] ?? p.type,
});

function toPatient(
  p: AppointmentPayload,
  draft: Omit<EmailDraft, 'to' | 'expiresAt'>,
): EmailDraft[] {
  if (!p.patientEmail) return [];
  return [{ to: p.patientEmail, expiresAt: p.startsAt, ...draft }];
}

export const appointmentEmails: EmailTemplates = {
  'appointment.created': (event) =>
    toPatient(event.payload, {
      template: 'appointment-booked',
      subject: `Qəbulunuz təsdiqləndi — ${subjectTime(event.payload.startsAt)}`,
      data: visitData(event.payload),
    }),

  'appointment.rescheduled': (event) => {
    const p = event.payload;
    return toPatient(p, {
      template: 'appointment-rescheduled',
      subject: `Qəbulunuzun vaxtı dəyişdi — ${subjectTime(p.startsAt)}`,
      data: {
        ...visitData(p),
        previousStartsAt: p.previous.startsAt,
        previousDoctorName: p.previous.doctorName,
        doctorChanged: p.previous.doctorId !== p.doctorId,
      },
    });
  },

  'appointment.cancelled': (event) => {
    const p = event.payload;
    if (!p.notifyPatient) return [];
    return toPatient(p, {
      template: 'appointment-cancelled',
      subject: `Qəbulunuz ləğv edildi — ${subjectTime(p.startsAt)}`,
      data: visitData(p),
    });
  },

  'appointment.reminder_due': (event) =>
    toPatient(event.payload, {
      template: 'appointment-reminder',
      subject: `Xatırlatma: sabah qəbulunuz var — ${subjectTime(event.payload.startsAt)}`,
      data: visitData(event.payload),
    }),
};
