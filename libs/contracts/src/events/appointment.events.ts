// appointment.events — published by appointment-service (DOC 5.6).
// Aggregate APPOINTMENT, key = appointment id. Payloads carry the booking
// snapshot (names, MRN, times, department) so consumers (notifications,
// emails, history) never call back. The patient's email is there for the
// confirmation / reminder emails — history templates never print it.

export const AppointmentEvents = {
  APPOINTMENT_CREATED: 'appointment.created',
  APPOINTMENT_UPDATED: 'appointment.updated',
  APPOINTMENT_RESCHEDULED: 'appointment.rescheduled',
  APPOINTMENT_CHECKED_IN: 'appointment.checked_in',
  APPOINTMENT_CANCELLED: 'appointment.cancelled',
} as const;

export type AppointmentTypeName = 'CONSULTATION' | 'FOLLOW_UP' | 'CHECK_UP';

export interface AppointmentPayload {
  appointmentId: string;
  patientId: string;
  patientName: string;
  patientMrn: string;
  patientEmail: string | null;
  doctorId: string;
  doctorName: string;
  departmentId: string;
  departmentName: string;
  departmentCode: string;
  startsAt: string; // ISO-8601 UTC
  endsAt: string;
  type: AppointmentTypeName;
}

// Type / reason / notes edited. changedFields holds field NAMES only — the
// visit reason itself never travels (history is read by ADMIN)
export interface AppointmentUpdatedPayload extends AppointmentPayload {
  changedFields: string[];
}

// New time and / or doctor; the payload is the appointment after the move
export interface AppointmentRescheduledPayload extends AppointmentPayload {
  previous: {
    startsAt: string;
    endsAt: string;
    doctorId: string;
    doctorName: string;
    departmentId: string;
    departmentName: string;
  };
}

// The slot is free again. reason = the front desk's cancellation note
export interface AppointmentCancelledPayload extends AppointmentPayload {
  reason: string;
  previousStatus: 'SCHEDULED' | 'CHECKED_IN';
}

export interface AppointmentEventPayloads {
  [AppointmentEvents.APPOINTMENT_CREATED]: AppointmentPayload;
  [AppointmentEvents.APPOINTMENT_UPDATED]: AppointmentUpdatedPayload;
  [AppointmentEvents.APPOINTMENT_RESCHEDULED]: AppointmentRescheduledPayload;
  [AppointmentEvents.APPOINTMENT_CHECKED_IN]: AppointmentPayload;
  [AppointmentEvents.APPOINTMENT_CANCELLED]: AppointmentCancelledPayload;
}
