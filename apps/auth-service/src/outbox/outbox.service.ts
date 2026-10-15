import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EntityManager } from 'typeorm';
import { CurrentUserData, requestContext } from '@medflow/common';
import { OutboxEvent } from './outbox-event.entity';

const TOPIC = 'auth.events';
const SOURCE = 'auth-service';

export type AuthEventType =
  | 'user.invited'
  | 'user.activated'
  | 'user.deactivated'
  | 'user.session_revoked'
  | 'user.password_reset_requested'
  | 'user.password_changed';

export interface OutboxEventInput {
  eventType: AuthEventType;
  userId: string; // aggregate id = Kafka key
  actor: CurrentUserData | null; // null = system / the user themself unauthenticated
  payload: Record<string, unknown>;
}

// Adds an event to the outbox inside the caller's transaction. The stored
// payload is the full envelope (DOC 5.2), so the poller can send it as-is.
// TODO(phase 3): replace with the shared OutboxService + typed contracts.
@Injectable()
export class OutboxService {
  async add(em: EntityManager, input: OutboxEventInput): Promise<void> {
    const id = randomUUID();
    const occurredAt = new Date();

    await em.insert(OutboxEvent, {
      id,
      topic: TOPIC,
      eventType: input.eventType,
      aggregateType: 'USER',
      aggregateId: input.userId,
      occurredAt,
      payload: {
        eventId: id,
        eventType: input.eventType,
        version: 1,
        occurredAt: occurredAt.toISOString(),
        source: SOURCE,
        correlationId: requestContext.get().requestId ?? undefined,
        actor: input.actor
          ? {
              id: input.actor.id,
              name: input.actor.name,
              role: input.actor.role,
            }
          : null,
        payload: input.payload,
      },
    });
  }
}
