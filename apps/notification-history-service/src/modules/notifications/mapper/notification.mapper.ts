import { Injectable } from '@nestjs/common';
import type { DomainEvent, EventEnvelope } from '@medflow/contracts';
import { Notification } from '../entities/notification.entity';
import { authNotifications } from './auth.notifications';
import {
  NotificationDraft,
  NotificationTemplates,
} from './notification-template';

export type NewNotification = Omit<
  Notification,
  'id' | 'isRead' | 'readAt' | 'createdAt'
>;

// Every event that notifies someone → its template. Each phase spreads the
// templates of its service in here (appointmentNotifications, …).
const TEMPLATES: NotificationTemplates = {
  ...authNotifications,
};

// (eventType, envelope) → notification rows, one per recipient (DOC 6.7)
@Injectable()
export class NotificationMapper {
  // [] = the event notifies nobody
  map(event: EventEnvelope): NewNotification[] {
    const template = TEMPLATES[
      event.eventType as keyof NotificationTemplates
    ] as ((event: DomainEvent) => NotificationDraft[]) | undefined;
    if (!template) return [];

    // One row per recipient, even if a template lists someone twice
    const drafts = new Map<string, NotificationDraft>();
    for (const draft of template(event as DomainEvent)) {
      drafts.set(draft.recipientId, draft);
    }
    return [...drafts.values()].map((draft) => ({
      eventId: event.eventId,
      recipientId: draft.recipientId,
      type: draft.type,
      title: clip(draft.title, 150),
      message: clip(draft.message, 500),
      entityType: draft.entityType ?? null,
      entityId: draft.entityId ?? null,
      link: draft.link ?? null,
      isUrgent: draft.isUrgent ?? false,
    }));
  }
}

// Titles and messages are built from names — never let a long one break
// the insert
function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
