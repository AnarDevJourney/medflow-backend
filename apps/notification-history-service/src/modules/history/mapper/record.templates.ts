import type {
  DomainEvent,
  EncounterPayload,
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
};

const who = (p: EncounterPayload) => `${p.patientName} (${p.patientMrn})`;

const metadataOf = (p: EncounterPayload) => ({
  mrn: p.patientMrn,
  doctorName: p.doctorName,
  departmentName: p.departmentName,
  appointmentType: p.appointmentType,
  startedAt: p.startedAt,
});

function entry(
  event: DomainEvent<RecordEventType>,
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
