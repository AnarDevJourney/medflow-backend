import type { DomainEvent, EventType } from '@medflow/contracts';

// One in-app notification an event produces (DOC 5.6 "in-app to …")
export interface NotificationDraft {
  recipientId: string;
  type: string; // 'SESSION_REVOKED', 'APPOINTMENT_CHECKED_IN', …
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  link?: string; // frontend route
  isUrgent?: boolean;
}

// Only the events that notify someone have a template; every other event
// produces no notification. Recipients come from the payload; events for a
// role / department (e.g. all nurses of a department) will resolve them via
// staff-service (phase 5+).
export type NotificationTemplates = {
  [K in EventType]?: (event: DomainEvent<K>) => NotificationDraft[];
};
