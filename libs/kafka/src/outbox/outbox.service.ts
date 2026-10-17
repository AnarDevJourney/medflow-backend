import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EntityManager } from 'typeorm';
import { requestContext } from '@medflow/common';
import type {
  EventActor,
  EventEnvelope,
  EventPayloadMap,
  EventType,
} from '@medflow/contracts';
import { KAFKA_OPTIONS, type KafkaModuleOptions } from '../kafka.constants';
import { OUTBOX_OPTIONS, type OutboxModuleOptions } from './outbox.constants';
import { OutboxEvent } from './outbox-event.entity';

export interface OutboxInput<E extends EventType> {
  eventType: E;
  aggregateType: string; // 'USER', 'APPOINTMENT', …
  aggregateId: string; // Kafka message key → per-aggregate ordering
  actor: EventActor | null; // null = system job / unauthenticated user
  payload: EventPayloadMap[E];
}

// Adds an event inside the caller's transaction (DOC 5.3): the business
// change and its event are committed together or not at all.
@Injectable()
export class OutboxService {
  private lastOccurredAt = 0;

  constructor(
    @Inject(KAFKA_OPTIONS) private readonly kafka: KafkaModuleOptions,
    @Inject(OUTBOX_OPTIONS) private readonly options: OutboxModuleOptions,
  ) {}

  async add<E extends EventType>(
    em: EntityManager,
    input: OutboxInput<E>,
  ): Promise<void> {
    const id = randomUUID();
    const occurredAt = this.nextOccurredAt();

    const envelope: EventEnvelope<EventPayloadMap[E], E> = {
      eventId: id,
      eventType: input.eventType,
      version: 1,
      occurredAt: occurredAt.toISOString(),
      source: this.kafka.serviceName,
      correlationId: requestContext.get().requestId ?? undefined,
      actor: input.actor
        ? { id: input.actor.id, name: input.actor.name, role: input.actor.role }
        : null,
      payload: input.payload,
    };

    await em.insert(OutboxEvent, {
      id,
      topic: this.options.topic,
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      occurredAt,
      payload: envelope,
    });
  }

  // The poller sends rows ordered by occurred_at. Two events written in the
  // same millisecond (user.invited + user.activated of the seed admin) would
  // tie and could go out swapped, so the clock never repeats a value.
  private nextOccurredAt(): Date {
    this.lastOccurredAt = Math.max(Date.now(), this.lastOccurredAt + 1);
    return new Date(this.lastOccurredAt);
  }
}
