import {
  BeforeApplicationShutdown,
  Inject,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import type {
  Consumer,
  EachBatchPayload,
  Kafka,
  KafkaMessage,
  Producer,
} from 'kafkajs';
import { setTimeout as sleep } from 'node:timers/promises';
import { DataSource, EntityManager } from 'typeorm';
import type { EventEnvelope, Topic } from '@medflow/contracts';
import {
  KAFKA_CLIENT,
  KAFKA_OPTIONS,
  KAFKA_PRODUCER,
  type KafkaModuleOptions,
} from '../kafka.constants';
import { RETRY_DELAYS_MS } from './base-consumer';
import { parseEnvelope, sendToDeadLetter } from './dead-letter';

export const DEFAULT_BATCH_MAX_BYTES = 1024 * 1024; // 1 MB

interface Rejected {
  message: KafkaMessage;
  error: Error;
}

interface SaveResult {
  inserted: number;
  poisoned: Rejected[];
}

// Base class of a high-volume consumer that writes many events with ONE
// database statement (notification-history's action history reads every
// topic). A subclass names its topics, maps each event to a row and stores
// a list of rows idempotently (INSERT … ON CONFLICT DO NOTHING):
//
//   @Injectable()
//   export class ActionHistoryConsumer extends BaseBatchConsumer<Row> {
//     protected readonly topics = [Topics.AUTH, Topics.STAFF, …];
//     protected toRow(event) { return mapper.map(event); }   // null = skip
//     protected saveRows(rows, em) { return repo.insertIgnore(rows, em); }
//   }
//
// Batching: one fetch returns at most `maxBytes` (1 MB). minBytes = 1, so
// the broker answers as soon as ANY message is there — it never waits for
// the megabyte to fill up; under load a fetch simply carries up to 1 MB.
// KafkaJS hands the fetch over per partition (eachBatch), and every
// partition batch is stored in one transaction, then its offset committed.
//
// Failures:
// - not an envelope / toRow throws → that message alone goes to the DLQ
// - a data error (SQLSTATE 22xxx/23xxx, e.g. a value too long) → the batch
//   is retried row by row, so only the poisoned row goes to the DLQ
// - anything else (database down) → retried 1 s, 5 s, 15 s; then thrown:
//   KafkaJS restarts the consumer and refetches from the last committed
//   offset, nothing is dead-lettered for an outage
export abstract class BaseBatchConsumer<R>
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  protected abstract readonly topics: readonly Topic[];
  // Upper bound of one fetch (and so of one partition batch)
  protected readonly maxBytes: number = DEFAULT_BATCH_MAX_BYTES;
  // Appended to the service name. Lets one service read the same topics
  // with several independent groups (each keeps its own offsets).
  protected readonly groupSuffix?: string;

  @Inject(KAFKA_CLIENT) private readonly kafka: Kafka;
  @Inject(KAFKA_PRODUCER) private readonly producer: Producer;
  @Inject(KAFKA_OPTIONS) private readonly options: KafkaModuleOptions;
  @Inject(DataSource) private readonly dataSource: DataSource;

  protected readonly logger = new Logger(this.constructor.name);
  private consumer?: Consumer;

  // The row to store for an event; null = not interesting, skipped.
  // Throwing means the event can never be stored → dead letters.
  protected abstract toRow(event: EventEnvelope): R | null;

  // Stores the rows in the given transaction, ignoring rows that already
  // exist (redelivery). Returns how many rows were really inserted.
  protected abstract saveRows(rows: R[], em: EntityManager): Promise<number>;

  protected get groupId(): string {
    const name = this.options.serviceName;
    return this.groupSuffix ? `${name}.${this.groupSuffix}` : name;
  }

  async onApplicationBootstrap() {
    this.consumer = this.kafka.consumer({
      groupId: this.groupId,
      allowAutoTopicCreation: false,
      maxBytes: this.maxBytes,
      maxBytesPerPartition: this.maxBytes,
      minBytes: 1, // answer as soon as there is something to read
    });
    await this.consumer.connect();
    await this.consumer.subscribe({
      topics: [...this.topics],
      fromBeginning: true,
    });
    await this.consumer.run({
      autoCommit: false,
      eachBatchAutoResolve: false,
      partitionsConsumedConcurrently: 3,
      eachBatch: (payload) => this.onBatch(payload),
    });
  }

  async beforeApplicationShutdown() {
    await this.consumer?.disconnect(); // waits for the batch in progress
  }

  private async onBatch(payload: EachBatchPayload) {
    const { batch } = payload;
    const { topic, partition, messages } = batch;
    if (messages.length === 0) return;

    const items: { message: KafkaMessage; row: R }[] = [];
    const rejected: Rejected[] = [];
    let skipped = 0;
    for (const message of messages) {
      try {
        const row = this.toRow(parseEnvelope(message));
        if (row === null) skipped++;
        else items.push({ message, row });
      } catch (error) {
        rejected.push({ message, error: error as Error });
      }
    }

    let inserted = 0;
    let poisoned = 0;
    if (items.length > 0) {
      const result = await this.save(items, () => payload.heartbeat());
      inserted = result.inserted;
      poisoned = result.poisoned.length;
      rejected.push(...result.poisoned);
    }
    for (const { message, error } of rejected) {
      await this.deadLetter(topic, partition, message, error);
    }

    const duplicates = items.length - inserted - poisoned;
    this.logger.log(
      `${topic}[${partition}] ${messages.length} message(s) → ${inserted} inserted in one transaction` +
        (duplicates > 0 ? `, ${duplicates} duplicate(s)` : '') +
        (skipped > 0 ? `, ${skipped} skipped` : '') +
        (rejected.length > 0 ? `, ${rejected.length} dead-lettered` : ''),
    );

    // A rebalance or seek happened meanwhile: the partition may belong to
    // another member now. The rows are idempotent, so leaving the offset
    // uncommitted only means a harmless redelivery.
    if (!payload.isRunning() || payload.isStale()) return;
    const last = batch.lastOffset();
    payload.resolveOffset(last);
    await payload.commitOffsetsIfNecessary({
      topics: [
        {
          topic,
          partitions: [{ partition, offset: (BigInt(last) + 1n).toString() }],
        },
      ],
    });
  }

  private async save(
    items: { message: KafkaMessage; row: R }[],
    heartbeat: () => Promise<void>,
  ): Promise<SaveResult> {
    for (let attempt = 0; ; attempt++) {
      try {
        const inserted = await this.dataSource.transaction((em) =>
          this.saveRows(
            items.map((item) => item.row),
            em,
          ),
        );
        return { inserted, poisoned: [] };
      } catch (error) {
        if (isDataError(error)) {
          this.logger.warn(
            `Batch of ${items.length} rejected by the database (${(error as Error).message}), saving row by row`,
          );
          return this.saveOneByOne(items);
        }
        if (attempt >= RETRY_DELAYS_MS.length) throw error;
        const delay = RETRY_DELAYS_MS[attempt];
        this.logger.warn(
          `Batch of ${items.length} failed (attempt ${attempt + 1}), retrying in ${delay / 1000}s: ${(error as Error).message}`,
        );
        await heartbeat(); // keep the group session alive while waiting
        await sleep(delay);
      }
    }
  }

  // Isolates the row(s) the database refuses; the rest is still stored
  private async saveOneByOne(
    items: { message: KafkaMessage; row: R }[],
  ): Promise<SaveResult> {
    const result: SaveResult = { inserted: 0, poisoned: [] };
    for (const { message, row } of items) {
      try {
        result.inserted += await this.dataSource.transaction((em) =>
          this.saveRows([row], em),
        );
      } catch (error) {
        if (!isDataError(error)) throw error;
        result.poisoned.push({ message, error: error as Error });
      }
    }
    return result;
  }

  private deadLetter(
    topic: string,
    partition: number,
    message: KafkaMessage,
    error: Error,
  ): Promise<void> {
    return sendToDeadLetter(
      this.producer,
      this.groupId,
      this.logger,
      topic,
      partition,
      message,
      error,
    );
  }
}

// SQLSTATE class 22 (data exception) or 23 (integrity constraint): the row
// itself is wrong, retrying the same row can never succeed
function isDataError(error: unknown): boolean {
  const err = error as { code?: unknown; driverError?: { code?: unknown } };
  const code = err.driverError?.code ?? err.code;
  return (
    typeof code === 'string' && (code.startsWith('22') || code.startsWith('23'))
  );
}
