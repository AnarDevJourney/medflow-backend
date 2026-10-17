import { EventEnvelope } from './envelope';
import { AuthEventPayloads } from './events/auth.events';

// Every event of the system → its payload type. Each phase adds the events
// of its service here (StaffEventPayloads & PatientEventPayloads & …).
export type EventPayloadMap = AuthEventPayloads;

export type EventType = keyof EventPayloadMap;

// A received / published event of a known type
export type DomainEvent<E extends EventType = EventType> = EventEnvelope<
  EventPayloadMap[E],
  E
>;
