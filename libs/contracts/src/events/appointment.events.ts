// appointment.events — published by appointment-service (DOC 5.6).
// Aggregate APPOINTMENT, key = appointment id. Payloads carry the booking
// snapshot (names, MRN, times, department) so consumers (notifications,
// emails, history) never call back. The patient's email is there for the
// confirmation / reminder emails — history templates never print it.

export const AppointmentEvents = {
  APPOINTMENT_CREATED: 'appointment.created',
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

export interface AppointmentEventPayloads {
  [AppointmentEvents.APPOINTMENT_CREATED]: AppointmentPayload;
}
