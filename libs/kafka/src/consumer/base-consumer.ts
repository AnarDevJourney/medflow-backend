import {
  BeforeApplicationShutdown,
  Inject,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import type {
  Consumer,
  EachMessagePayload,
  Kafka,
  KafkaMessage,
  Producer,
} from 'kafkajs';
import { setTimeout as sleep } from 'node:timers/promises';
import { DataSource, EntityManager } from 'typeorm';
import { requestContext } from '@medflow/common';
import {
  DeadLetter,
  DomainEvent,
  EventEnvelope,
  EventType,
  Topic,
  Topics,
} from '@medflow/contracts';
import {
  KAFKA_CLIENT,
  KAFKA_OPTIONS,
  KAFKA_PRODUCER,
  type KafkaModuleOptions,
} from '../kafka.constants';
import { ProcessedEvent } from './processed-event.entity';

// Only the events a consumer cares about; the rest are skipped
export type EventHandlers = {
  [E in EventType]?: (
    event: DomainEvent<E>,
    em: EntityManager,
  ) => Promise<void>;
};

const RETRY_DELAYS_MS = [1000, 5000, 15000];

// Message that can never succeed (not JSON, not an envelope) → straight to
// the dead letters, no retries
class InvalidMessageError extends Error {}

// Base class of every Kafka consumer (DOC 5.4, 5.5). A subclass names its
// topic and handlers:
//
//   @Injectable()
//   export class AuthEventsConsumer extends BaseConsumer {
//     protected readonly topic = Topics.AUTH;
//     protected readonly handlers: EventHandlers = {
//       'user.invited': (event, em) => this.staff.createProfile(event.payload, em),
//     };
//   }
//
// Per message: handler + processed_events row in ONE transaction (duplicate
// → skipped), 3 retries (1 s, 5 s, 15 s), then dead-letter.events. The
// offset is committed only after that, so nothing is lost on a crash —
// it is redelivered and the idempotency check catches the repeat.
// Consumer group = service name: replicas share the partitions.
export abstract class BaseConsumer
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  protected abstract readonly topic: Topic;
  protected abstract readonly handlers: EventHandlers;
  // false: the handler is idempotent by itself (notification-history's
  // unique event_id columns) and no processed_events row is written
  protected readonly useProcessedEvents: boolean = true;

  @Inject(KAFKA_CLIENT) private readonly kafka: Kafka;
  @Inject(KAFKA_PRODUCER) private readonly producer: Producer;
  @Inject(KAFKA_OPTIONS) private readonly options: KafkaModuleOptions;
  @Inject(DataSource) private readonly dataSource: DataSource;

  protected readonly logger = new Logger(this.constructor.name);
  private consumer?: Consumer;

  async onApplicationBootstrap() {
    this.consumer = this.kafka.consumer({
      groupId: this.options.serviceName,
      allowAutoTopicCreation: false,
    });
    await this.consumer.connect();
    // A new group starts at the beginning of the topic, so events published
    // before the service first ran are not missed
    await this.consumer.subscribe({ topic: this.topic, fromBeginning: true });
    await this.consumer.run({
      autoCommit: false,
      partitionsConsumedConcurrently: 3, // one per partition, order per key kept
      eachMessage: (payload) => this.onMessage(payload),
    });
  }

  async beforeApplicationShutdown() {
    await this.consumer?.disconnect(); // waits for the message in progress
  }

  private async onMessage(payload: EachMessagePayload) {
    const { topic, partition, message } = payload;
    try {
      const event = parseEnvelope(message);
      await this.processWithRetries(event, () => payload.heartbeat());
    } catch (error) {
      await this.deadLetter(topic, partition, message, error as Error);
    }
    // Only now: handled, skipped or parked in the dead letters
    await this.consumer!.commitOffsets([
      { topic, partition, offset: (BigInt(message.offset) + 1n).toString() },
    ]);
  }

  private async processWithRetries(
    event: EventEnvelope,
    heartbeat: () => Promise<void>,
  ): Promise<void> {
    const handler = this.handlers[event.eventType as EventType] as
      ((event: EventEnvelope, em: EntityManager) => Promise<void>) | undefined;
    if (!handler) return; // not interesting for this service

    for (let attempt = 0; ; attempt++) {
      try {
        // Logs of the handler carry the id of the request that caused the event
        await requestContext.run(
          { requestId: event.correlationId ?? null },
          () => this.process(event, handler),
        );
        return;
      } catch (error) {
        if (attempt >= RETRY_DELAYS_MS.length) throw error;
        const delay = RETRY_DELAYS_MS[attempt];
        this.logger.warn(
          `${event.eventType} ${event.eventId} failed (attempt ${attempt + 1}), retrying in ${delay / 1000}s: ${(error as Error).message}`,
        );
        await heartbeat(); // keep the group session alive while waiting
        await sleep(delay);
      }
    }
  }

  private process(
    event: EventEnvelope,
    handler: (event: EventEnvelope, em: EntityManager) => Promise<void>,
  ): Promise<void> {
    return this.dataSource.transaction(async (em) => {
      if (this.useProcessedEvents) {
        const result = await em
          .createQueryBuilder()
          .insert()
          .into(ProcessedEvent)
          .values({ eventId: event.eventId, eventType: event.eventType })
          .orIgnore() // ON CONFLICT DO NOTHING
          .returning('event_id')
          .execute();
        if ((result.raw as unknown[]).length === 0) {
          this.logger.log(
            `Duplicate ${event.eventType} ${event.eventId} skipped`,
          );
          return;
        }
      }
      await handler(event, em);
    });
  }

  private async deadLetter(
    topic: string,
    partition: number,
    message: KafkaMessage,
    error: Error,
  ): Promise<void> {
    const letter: DeadLetter = {
      originalTopic: topic,
      partition,
      offset: message.offset,
      key: message.key?.toString() ?? null,
      value: message.value?.toString() ?? null,
      error: error.message,
      failedBy: this.options.serviceName,
      failedAt: new Date().toISOString(),
    };
    // If this send fails too, the error propagates: the offset is not
    // committed and KafkaJS redelivers the message later
    await this.producer.send({
      topic: Topics.DEAD_LETTER,
      messages: [{ key: letter.key, value: JSON.stringify(letter) }],
    });
    const kind =
      error instanceof InvalidMessageError ? 'Invalid message' : 'Message';
    this.logger.error(
      `${kind} at ${topic}[${partition}]@${message.offset} moved to ${Topics.DEAD_LETTER}: ${error.message}`,
    );
  }
}

function parseEnvelope(message: KafkaMessage): EventEnvelope {
  let value: unknown;
  try {
    value = JSON.parse(message.value?.toString() ?? '');
  } catch {
    throw new InvalidMessageError('Message is not valid JSON');
  }
  const envelope = value as Partial<EventEnvelope> | null;
  if (
    typeof envelope?.eventId !== 'string' ||
    typeof envelope.eventType !== 'string' ||
    typeof envelope.payload !== 'object' ||
    envelope.payload === null
  ) {
    throw new InvalidMessageError('Message is not an event envelope');
  }
  return envelope as EventEnvelope;
}
