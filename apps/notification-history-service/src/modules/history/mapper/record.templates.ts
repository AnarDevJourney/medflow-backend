import { icd10AggregateId } from '@medflow/contracts';
import type {
  DomainEvent,
  EncounterPayload,
  EncounterRefPayload,
  RecordEventPayloads,
} from '@medflow/contracts';
import {
  actorName,
  HistoryEntry,
  HistoryEventType,
  HistoryTemplates,
  message,
} from './history-template';

const ENCOUNTER = 'ENCOUNTER';

type RecordEventType = Extract<HistoryEventType, keyof RecordEventPayloads>;

// record.events. Entity = the visit and patientId is set (patient
// timeline). Who, which doctor and department — never the complaint,
// diagnoses, drugs or results (ADMIN reads the history).
export const recordTemplates: HistoryTemplates<RecordEventType> = {
  'encounter.started': (event) =>
    entry(
      event,
      `started the visit of ${who(event.payload)}`,
      'encounter.started',
    ),

  'encounter.closed': (event) => ({
    ...entry(
      event,
      `closed the visit of ${who(event.payload)}`,
      'encounter.closed',
    ),
    metadata: {
      ...metadataOf(event.payload),
      closedAt: event.payload.closedAt,
      labTestCount: event.payload.labTestCodes.length,
    },
  }),

  // Only that it happened — never the values or the diagnosis itself
  'vitals.recorded': (event) => ({
    ...refEntry(
      event,
      `recorded vital signs in the visit of`,
      'vitals.recorded',
    ),
    metadata: {
      ...refMetadata(event.payload),
      recordedAt: event.payload.recordedAt,
    },
  }),

  'diagnosis.added': (event) =>
    refEntry(event, 'added a diagnosis to the visit of', 'diagnosis.added'),

  // The catalogue, not a patient: names the code, never a person's data
  'icd10.updated': (event) => {
    const p = event.payload;
    const key = !p.changedFields.includes('isActive')
      ? 'icd10.updated'
      : p.isActive
        ? 'icd10.activated'
        : 'icd10.deactivated';
    const verb = {
      'icd10.updated': 'updated',
      'icd10.activated': 'activated',
      'icd10.deactivated': 'deactivated',
    }[key];
    return {
      entityType: 'ICD10_CODE',
      entityId: icd10AggregateId(p.code),
      patientId: null,
      summary: `${actorName(event)} ${verb} the diagnosis ${p.code} (${p.title}) in the catalogue`,
      message: message(key, {
        actor: event.actor?.name ?? null,
        code: p.code,
        title: p.title,
      }),
      metadata: { code: p.code, changedFields: p.changedFields },
    };
  },

  'diagnosis.removed': (event) =>
    refEntry(
      event,
      'removed a diagnosis from the visit of',
      'diagnosis.removed',
    ),
};

const who = (p: EncounterRefPayload) => `${p.patientName} (${p.patientMrn})`;

const refMetadata = (p: EncounterRefPayload) => ({
  mrn: p.patientMrn,
  doctorName: p.doctorName,
});

// Events about something inside a visit (vitals, diagnoses)
function refEntry(
  event: DomainEvent<RecordEventType>,
  text: string,
  key: string,
): HistoryEntry {
  const p = event.payload as EncounterRefPayload;
  return {
    entityType: ENCOUNTER,
    entityId: p.encounterId,
    patientId: p.patientId,
    summary: `${actorName(event)} ${text} ${who(p)}`,
    message: message(key, {
      actor: event.actor?.name ?? null,
      name: p.patientName,
      mrn: p.patientMrn,
      doctor: p.doctorName,
    }),
    metadata: refMetadata(p),
  };
}

const metadataOf = (p: EncounterPayload) => ({
  mrn: p.patientMrn,
  doctorName: p.doctorName,
  departmentName: p.departmentName,
  appointmentType: p.appointmentType,
  startedAt: p.startedAt,
});

function entry(
  event: DomainEvent<'encounter.started' | 'encounter.closed'>,
  text: string,
  key: string,
): HistoryEntry {
  const p = event.payload;
  return {
    entityType: ENCOUNTER,
    entityId: p.encounterId,
    patientId: p.patientId,
    summary: `${actorName(event)} ${text}`,
    message: message(key, {
      actor: event.actor?.name ?? null,
      name: p.patientName,
      mrn: p.patientMrn,
      doctor: p.doctorName,
    }),
    metadata: metadataOf(p),
  };
}
