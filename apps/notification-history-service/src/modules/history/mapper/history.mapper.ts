import { Injectable } from '@nestjs/common';
import type { DomainEvent, EventEnvelope } from '@medflow/contracts';
import { ActionHistory } from '../entities/action-history.entity';
import { authTemplates } from './auth.templates';
import {
  HistoryEntry,
  HistoryEventType,
  HistoryTemplates,
  NOT_IN_HISTORY,
} from './history-template';

export type NewActionHistory = Omit<ActionHistory, 'id' | 'createdAt'>;

// Every event of the system → its summary template. Each phase spreads the
// templates of its service in here (staffTemplates, patientTemplates, …).
const TEMPLATES: HistoryTemplates<HistoryEventType> = {
  ...authTemplates,
};

const SKIPPED: ReadonlySet<string> = new Set(NOT_IN_HISTORY);

// (eventType, envelope) → action_history row (DOC 6.7). Generic part from
// the envelope (who, when, correlation), event-specific part from a template.
@Injectable()
export class HistoryMapper {
  // null = the event is not recorded. Throws for an unknown event type —
  // the consumer parks it in the dead letters, so it can be replayed once
  // a template exists.
  map(event: EventEnvelope): NewActionHistory | null {
    if (SKIPPED.has(event.eventType)) return null;

    const template = TEMPLATES[event.eventType as HistoryEventType] as
      ((event: DomainEvent) => HistoryEntry) | undefined;
    if (!template) {
      throw new Error(`No history template for ${event.eventType}`);
    }
    const entry = template(event as DomainEvent);

    return {
      eventId: event.eventId,
      eventType: event.eventType,
      source: event.source,
      actorId: event.actor?.id ?? null,
      actorName: clip(event.actor?.name, 200),
      actorRole: event.actor?.role ?? null,
      entityType: entry.entityType,
      entityId: entry.entityId,
      patientId: entry.patientId ?? null,
      summary: clip(entry.summary, 500)!,
      metadata: entry.metadata ?? {},
      correlationId: clip(event.correlationId, 64),
      occurredAt: new Date(event.occurredAt),
    };
  }
}

// Names and summaries are free text — never let a long one break the insert
function clip(value: string | undefined, max: number): string | null {
  if (value === undefined) return null;
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
