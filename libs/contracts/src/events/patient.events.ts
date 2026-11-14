// patient.events — published by patient-service (DOC 5.6).
// Aggregate PATIENT, key = patient id. Payloads carry demographics only —
// never clinical values; dates of birth and addresses stay in the service.

export const PatientEvents = {
  PATIENT_REGISTERED: 'patient.registered',
  PATIENT_UPDATED: 'patient.updated',
  PATIENT_DEACTIVATED: 'patient.deactivated',
  PATIENT_REACTIVATED: 'patient.reactivated',
} as const;

// The patient as other services snapshot them (appointment, billing):
// name, MRN and the contact details used for reminders and receipts.
export interface PatientPayload {
  patientId: string;
  mrn: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
}

// The patient after the change. changedFields holds field NAMES —
// appointment-service refreshes its snapshots when name / phone / email change.
export interface PatientUpdatedPayload extends PatientPayload {
  changedFields: string[];
}

export interface PatientEventPayloads {
  [PatientEvents.PATIENT_REGISTERED]: PatientPayload;
  [PatientEvents.PATIENT_UPDATED]: PatientUpdatedPayload;
  [PatientEvents.PATIENT_DEACTIVATED]: PatientPayload;
  [PatientEvents.PATIENT_REACTIVATED]: PatientPayload;
}
