// Who caused an event. null = a system job or an unauthenticated user
// (e.g. forgot-password).
export interface EventActor {
  id: string;
  name: string;
  role: string;
}

// Every Kafka message has this shape (DOC 5.2). It is stored as-is in
// outbox_events.payload and sent unchanged by the outbox poller.
export interface EventEnvelope<T = unknown, E extends string = string> {
  eventId: string; // uuid = outbox_events.id → idempotency key everywhere
  eventType: E;
  version: 1; // bump when the payload shape changes
  occurredAt: string; // ISO timestamp of the business change
  source: string; // producing service, e.g. 'auth-service'
  correlationId?: string; // x-request-id of the HTTP request that caused it
  actor: EventActor | null;
  payload: T;
}

// What a consumer publishes to dead-letter.events after the last retry
// (DOC 5.5). `value` is the original message exactly as it was received.
export interface DeadLetter {
  originalTopic: string;
  partition: number;
  offset: string;
  key: string | null;
  value: string | null;
  error: string;
  failedBy: string; // consumer group = service name
  failedAt: string;
}
