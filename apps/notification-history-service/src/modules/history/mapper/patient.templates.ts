import type { DomainEvent, PatientEventPayloads } from '@medflow/contracts';
import {
  actorName,
  message,
  HistoryEventType,
  HistoryTemplates,
} from './history-template';

const PATIENT = 'PATIENT';
const actor = (event: DomainEvent): string | null => event.actor?.name ?? null;

type PatientEventType = Extract<HistoryEventType, keyof PatientEventPayloads>;

// patient.events. Entity = the patient and patientId is set, so every row
// also shows up on the patient timeline. Names and the MRN only — never
// the birth date, contacts or other demographics.
export const patientTemplates: HistoryTemplates<PatientEventType> = {
  'patient.registered': (event) =>
    entry(event, 'registered the patient', 'patient.registered'),

  'patient.updated': (event) => {
    const p = event.payload;
    const fields = p.changedFields.join(', ');
    return {
      ...entry(event, 'updated the details of', 'patient.updated', {
        fields: p.changedFields,
      }),
      summary: `${actorName(event)} updated the details of ${nameOf(p)} (${p.mrn}): ${fields}`,
      metadata: { mrn: p.mrn, changedFields: p.changedFields },
    };
  },

  'patient.deactivated': (event) =>
    entry(event, 'deactivated the record of', 'patient.deactivated'),

  'patient.reactivated': (event) =>
    entry(event, 'reactivated the record of', 'patient.reactivated'),

  // Clinical summary: which patient and that the list changed — never the
  // allergen, diagnosis, severity or notes (ADMIN reads the history)
  'patient.allergy_added': (event) =>
    entry(event, 'added an allergy to the record of', 'patient.allergyAdded'),
  'patient.allergy_updated': (event) => ({
    ...entry(event, 'updated an allergy of', 'patient.allergyUpdated', {
      fields: event.payload.changedFields,
    }),
    metadata: {
      mrn: event.payload.mrn,
      changedFields: event.payload.changedFields,
    },
  }),
  'patient.allergy_removed': (event) =>
    entry(
      event,
      'removed an allergy from the record of',
      'patient.allergyRemoved',
    ),
  'patient.condition_added': (event) =>
    entry(
      event,
      'added a chronic condition to the record of',
      'patient.conditionAdded',
    ),
  'patient.condition_updated': (event) => ({
    ...entry(
      event,
      'updated a chronic condition of',
      'patient.conditionUpdated',
      {
        fields: event.payload.changedFields,
      },
    ),
    metadata: {
      mrn: event.payload.mrn,
      changedFields: event.payload.changedFields,
    },
  }),
  'patient.condition_removed': (event) =>
    entry(
      event,
      'removed a chronic condition from the record of',
      'patient.conditionRemoved',
    ),
};

const nameOf = (p: { firstName: string; lastName: string }) =>
  `${p.firstName} ${p.lastName}`;

function entry(
  event: DomainEvent<PatientEventType>,
  verb: string,
  key: string,
  extra: Record<string, string[]> = {},
) {
  const p = event.payload;
  return {
    entityType: PATIENT,
    entityId: p.patientId,
    patientId: p.patientId,
    summary: `${actorName(event)} ${verb} ${nameOf(p)} (${p.mrn})`,
    message: message(key, {
      actor: actor(event),
      name: nameOf(p),
      mrn: p.mrn,
      ...extra,
    }),
    metadata: { mrn: p.mrn },
  };
}
