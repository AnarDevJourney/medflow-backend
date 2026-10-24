import type { DomainEvent, EventType } from '@medflow/contracts';

// What one event contributes to its action_history row; who / when /
// correlation come from the envelope itself (DOC 5.2, 6.7)
export interface HistoryEntry {
  entityType: string; // 'USER', 'APPOINTMENT', …
  entityId: string;
  patientId?: string | null; // set → the row shows up in the patient timeline
  // Readable by ADMIN: never clinical values (diagnoses, results, drugs).
  // English; kept as the fallback for clients without the key.
  summary: string;
  // The same sentence for the UI to translate: historyEvents.<key> in the
  // frontend locales, filled with the params
  message: HistoryMessage;
  // Ids, changed field NAMES, amounts — never clinical values or tokens
  metadata?: Record<string, unknown>;
}

// Params are data, never translated text: names, emails, role codes
// ('NURSE'), field names ('firstName'). actor null = the system.
export interface HistoryMessage {
  key: string;
  params: Record<string, string | string[] | null>;
}

export const message = (
  key: string,
  params: HistoryMessage['params'] = {},
): HistoryMessage => ({ key, params });

// Events that never reach the action history (DOC 5.6)
export const NOT_IN_HISTORY = [
  'user.password_reset_requested', // carries the reset link, nothing happened yet
] as const satisfies readonly EventType[];

export type HistoryEventType = Exclude<
  EventType,
  (typeof NOT_IN_HISTORY)[number]
>;

// One summary template per event. Typed as a complete map, so adding an
// event to the contracts without a template fails to compile.
export type HistoryTemplates<E extends HistoryEventType> = {
  [K in E]: (event: DomainEvent<K>) => HistoryEntry;
};

// "Nigar Hasanova" or "System" for events without a user behind them
export const actorName = (event: DomainEvent): string =>
  event.actor?.name ?? 'System';
