// patient.events — published by patient-service (DOC 5.6).
// Aggregate PATIENT, key = patient id. Payloads carry demographics only —
// never clinical values; dates of birth and addresses stay in the service.

export const PatientEvents = {
  PATIENT_REGISTERED: 'patient.registered',
  PATIENT_UPDATED: 'patient.updated',
  PATIENT_DEACTIVATED: 'patient.deactivated',
  PATIENT_REACTIVATED: 'patient.reactivated',
  ALLERGY_ADDED: 'patient.allergy_added',
  ALLERGY_UPDATED: 'patient.allergy_updated',
  ALLERGY_REMOVED: 'patient.allergy_removed',
  CONDITION_ADDED: 'patient.condition_added',
  CONDITION_UPDATED: 'patient.condition_updated',
  CONDITION_REMOVED: 'patient.condition_removed',
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

// The clinical summary changed (allergies, chronic conditions). Who the
// patient is and which record — never the allergen, diagnosis, severity or
// notes: the action history is readable by ADMIN (DOC 6.7).
export interface PatientClinicalPayload {
  patientId: string;
  mrn: string;
  firstName: string;
  lastName: string;
}

export interface AllergyPayload extends PatientClinicalPayload {
  allergyId: string;
}

// changedFields holds field NAMES only (allergen, severity …)
export interface AllergyUpdatedPayload extends AllergyPayload {
  changedFields: string[];
}

export interface ConditionPayload extends PatientClinicalPayload {
  conditionId: string;
}

// changedFields holds field NAMES only (status, notes …)
export interface ConditionUpdatedPayload extends ConditionPayload {
  changedFields: string[];
}

export interface PatientEventPayloads {
  [PatientEvents.PATIENT_REGISTERED]: PatientPayload;
  [PatientEvents.PATIENT_UPDATED]: PatientUpdatedPayload;
  [PatientEvents.PATIENT_DEACTIVATED]: PatientPayload;
  [PatientEvents.PATIENT_REACTIVATED]: PatientPayload;
  [PatientEvents.ALLERGY_ADDED]: AllergyPayload;
  [PatientEvents.ALLERGY_UPDATED]: AllergyUpdatedPayload;
  [PatientEvents.ALLERGY_REMOVED]: AllergyPayload;
  [PatientEvents.CONDITION_ADDED]: ConditionPayload;
  [PatientEvents.CONDITION_UPDATED]: ConditionUpdatedPayload;
  [PatientEvents.CONDITION_REMOVED]: ConditionPayload;
}
