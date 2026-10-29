import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';
import { DOMAIN_TOPICS } from '@medflow/contracts';
import type {
  EventEnvelope,
  RolePermissionsUpdatedPayload,
} from '@medflow/contracts';
import { Role } from '@medflow/common';
import { BaseBatchConsumer } from '@medflow/kafka';
import { Notification } from '../modules/notifications/entities/notification.entity';
import {
  NewNotification,
  NotificationMapper,
} from '../modules/notifications/mapper/notification.mapper';
import {
  NotificationRow,
  rowToResponse,
} from '../modules/notifications/notification.response';
import { NotificationsGateway } from '../modules/notifications/notifications.gateway';

// 9 parameters per row; Postgres allows 65 535 per statement
const ROWS_PER_INSERT = 1000;

// Events after which the user's older sockets must close (their tokens are
// revoked too — auth:revoked-before)
const REVOKES_SESSIONS = new Set([
  'user.deactivated',
  'user.session_revoked',
  'user.password_changed',
]);

// Events → in-app notifications (DOC 5.6, 6.7), written in batches like the
// action history: everything one fetch brought (≤ NOTIFICATION_BATCH_MAX_BYTES)
// for a partition in one transaction. Own consumer group, so it never holds
// the history back (and vice versa).
//
// After the commit only the rows really inserted are pushed over Socket.io
// (a redelivered event is never pushed twice, a rolled-back row never). A
// notification whose event is older than NOTIFICATION_PUSH_MAX_AGE_SECONDS
// (e.g. replayed after an outage) is stored and counted, but not pushed as
// a live popup.
@Injectable()
export class NotificationsConsumer extends BaseBatchConsumer<
  NewNotification,
  NotificationRow
> {
  protected readonly topics = DOMAIN_TOPICS;
  protected readonly groupSuffix = 'notifications';
  protected readonly maxBytes: number;
  private readonly pushMaxAgeMs: number;

  constructor(
    private readonly mapper: NotificationMapper,
    private readonly gateway: NotificationsGateway,
    config: ConfigService,
  ) {
    super();
    this.maxBytes = config.getOrThrow<number>('NOTIFICATION_BATCH_MAX_BYTES');
    this.pushMaxAgeMs =
      config.getOrThrow<number>('NOTIFICATION_PUSH_MAX_AGE_SECONDS') * 1000;
  }

  protected toRows(event: EventEnvelope): NewNotification[] {
    return this.mapper.map(event);
  }

  // INSERT … ON CONFLICT (event_id, recipient_id) DO NOTHING RETURNING *
  protected async saveRows(
    rows: NewNotification[],
    em: EntityManager,
  ): Promise<NotificationRow[]> {
    const inserted: NotificationRow[] = [];
    for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
      const result = await em
        .createQueryBuilder()
        .insert()
        .into(Notification)
        .values(rows.slice(i, i + ROWS_PER_INSERT))
        .orIgnore()
        .returning('*')
        .updateEntity(false)
        .execute();
      inserted.push(...(result.raw as NotificationRow[]));
    }
    return inserted;
  }

  protected async afterCommit(
    saved: NotificationRow[],
    events: EventEnvelope[],
  ): Promise<void> {
    const occurredAt = new Map(
      events.map((e) => [e.eventId, Date.parse(e.occurredAt)]),
    );

    let stale = 0;
    for (const row of saved) {
      const age = Date.now() - (occurredAt.get(row.event_id) ?? 0);
      if (age <= this.pushMaxAgeMs) {
        this.gateway.pushNotification(row.recipient_id, rowToResponse(row));
      } else {
        stale++;
      }
    }
    if (stale > 0) {
      this.logger.log(
        `${stale} notification(s) older than ${this.pushMaxAgeMs / 1000}s stored without a live push`,
      );
    }
    await this.gateway.pushCounts([
      ...new Set(saved.map((row) => row.recipient_id)),
    ]);

    for (const event of events) {
      // A replayed old list must not reach the clients
      if (
        event.eventType === 'role_permissions.updated' &&
        Date.now() - Date.parse(event.occurredAt) <= this.pushMaxAgeMs
      ) {
        const { role, permissions } =
          event.payload as RolePermissionsUpdatedPayload;
        this.gateway.pushPermissions(role as Role, permissions);
      }
      if (!REVOKES_SESSIONS.has(event.eventType)) continue;
      const { userId } = event.payload as { userId: string };
      await this.gateway.revokeSockets(userId, Date.parse(event.occurredAt));
    }
  }
}
