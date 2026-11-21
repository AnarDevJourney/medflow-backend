// record.events — published by medical-record-service (DOC 5.6).
// Aggregate ENCOUNTER, key = encounter id (all events of one visit stay in
// order on one partition). Payloads carry who / which visit — never the
// complaint, findings, diagnoses or drugs: the action history is readable
// by ADMIN. encounter.closed is "fat" for billing (codes, type, email).

import { createHash } from 'node:crypto';
import type { AppointmentTypeName } from './appointment.events';

export const RecordEvents = {
  ENCOUNTER_STARTED: 'encounter.started',
  ENCOUNTER_CLOSED: 'encounter.closed',
  VITALS_RECORDED: 'vitals.recorded',
  DIAGNOSIS_ADDED: 'diagnosis.added',
  DIAGNOSIS_REMOVED: 'diagnosis.removed',
  ICD10_UPDATED: 'icd10.updated',
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

// Which visit something happened in (vitals, diagnoses). No values, codes
// or titles — only that it happened and who did it.
export interface EncounterRefPayload {
  encounterId: string;
  patientId: string;
  patientName: string;
  patientMrn: string;
  doctorId: string;
  doctorName: string;
}

// A set of vital signs was saved (doctor or nurse)
export interface VitalsRecordedPayload extends EncounterRefPayload {
  vitalsId: string;
  recordedAt: string;
}

// A diagnosis was added to / removed from an open visit
export interface DiagnosisPayload extends EncounterRefPayload {
  diagnosisId: string;
  primary: boolean;
}

// An admin changed a catalogue entry (activated, deactivated, named it).
// Aggregate ICD10_CODE, id = icd10AggregateId(code).
export interface Icd10UpdatedPayload {
  code: string;
  title: string; // the official English title (title_en)
  changedFields: (
    | 'isActive'
    | 'titleAz'
    | 'titleRu'
    | 'titleAzVerified'
    | 'titleRuVerified'
    | 'synonyms'
  )[];
  isActive: boolean;
}

// outbox / action_history ids are uuids; a code gets a stable one
export function icd10AggregateId(code: string): string {
  const hash = createHash('sha1').update(`medflow:icd10:${code}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface RecordEventPayloads {
  [RecordEvents.ENCOUNTER_STARTED]: EncounterPayload;
  [RecordEvents.ENCOUNTER_CLOSED]: EncounterClosedPayload;
  [RecordEvents.VITALS_RECORDED]: VitalsRecordedPayload;
  [RecordEvents.DIAGNOSIS_ADDED]: DiagnosisPayload;
  [RecordEvents.DIAGNOSIS_REMOVED]: DiagnosisPayload;
  [RecordEvents.ICD10_UPDATED]: Icd10UpdatedPayload;
}
