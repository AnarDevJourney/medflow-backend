import { EventActor } from '@medflow/contracts';
import { ActionHistory } from './entities/action-history.entity';

export interface HistoryResponse {
  id: string;
  eventId: string;
  eventType: string;
  source: string;
  actor: EventActor | null; // null = system
  entityType: string;
  entityId: string;
  patientId: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  correlationId: string | null;
  occurredAt: Date;
}

export function toHistoryResponse(row: ActionHistory): HistoryResponse {
  return {
    id: row.id,
    eventId: row.eventId,
    eventType: row.eventType,
    source: row.source,
    actor: row.actorId
      ? {
          id: row.actorId,
          name: row.actorName ?? '',
          role: row.actorRole ?? '',
        }
      : null,
    entityType: row.entityType,
    entityId: row.entityId,
    patientId: row.patientId,
    summary: row.summary,
    metadata: row.metadata,
    correlationId: row.correlationId,
    occurredAt: row.occurredAt,
  };
}
