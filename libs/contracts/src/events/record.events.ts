// record.events — published by medical-record-service (DOC 5.6).
// Aggregate ENCOUNTER, key = encounter id (all events of one visit stay in
// order on one partition). Payloads carry who / which visit — never the
// complaint, findings, diagnoses or drugs: the action history is readable
// by ADMIN. encounter.closed is "fat" for billing (codes, type, email).

import type { AppointmentTypeName } from './appointment.events';

export const RecordEvents = {
  ENCOUNTER_STARTED: 'encounter.started',
  ENCOUNTER_CLOSED: 'encounter.closed',
} as const;

// The visit as other services snapshot it
export interface EncounterPayload {
  encounterId: string;
  appointmentId: string;
  patientId: string;
  patientName: string;
  patientMrn: string;
  doctorId: string;
  doctorName: string;
  departmentId: string;
  departmentName: string;
  departmentCode: string;
  appointmentType: AppointmentTypeName;
  startedAt: string; // ISO-8601 UTC
}

// The visit is over (appointment → COMPLETED, billing → DRAFT invoice).
// labTestCodes = the tests ordered and not cancelled ('CBC' → 'LAB-CBC').
export interface EncounterClosedPayload extends EncounterPayload {
  patientEmail: string | null;
  closedAt: string;
  labTestCodes: string[];
  followUpInDays: number | null;
}

export interface RecordEventPayloads {
  [RecordEvents.ENCOUNTER_STARTED]: EncounterPayload;
  [RecordEvents.ENCOUNTER_CLOSED]: EncounterClosedPayload;
}
