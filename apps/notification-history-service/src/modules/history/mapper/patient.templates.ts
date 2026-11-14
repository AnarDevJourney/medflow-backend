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
