import { EventEnvelope } from './envelope';
import { AuthEventPayloads } from './events/auth.events';
import { ConfigurationsEventPayloads } from './events/configurations.events';
import { StaffEventPayloads } from './events/staff.events';

// Every event of the system → its payload type. Each phase adds the events
// of its service here (PatientEventPayloads & …).
export type EventPayloadMap = AuthEventPayloads &
  ConfigurationsEventPayloads &
  StaffEventPayloads;

export type EventType = keyof EventPayloadMap;

// A received / published event of a known type
export type DomainEvent<E extends EventType = EventType> = EventEnvelope<
  EventPayloadMap[E],
  E
>;
