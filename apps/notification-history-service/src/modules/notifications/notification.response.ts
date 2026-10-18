import { Notification } from './entities/notification.entity';

export interface NotificationResponse {
  id: string;
  type: string;
  title: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  link: string | null;
  isUrgent: boolean;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
}

export function toNotificationResponse(n: Notification): NotificationResponse {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    message: n.message,
    entityType: n.entityType,
    entityId: n.entityId,
    link: n.link,
    isUrgent: n.isUrgent,
    isRead: n.isRead,
    readAt: n.readAt,
    createdAt: n.createdAt,
  };
}

// A row as returned by INSERT … RETURNING * / UPDATE … RETURNING * (raw
// snake_case columns, not mapped by TypeORM)
export interface NotificationRow {
  id: string;
  event_id: string;
  recipient_id: string;
  type: string;
  title: string;
  message: string;
  entity_type: string | null;
  entity_id: string | null;
  link: string | null;
  is_urgent: boolean;
  is_read: boolean;
  read_at: Date | null;
  created_at: Date;
}

export function rowToResponse(row: NotificationRow): NotificationResponse {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    entityType: row.entity_type,
    entityId: row.entity_id,
    link: row.link,
    isUrgent: row.is_urgent,
    isRead: row.is_read,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}
