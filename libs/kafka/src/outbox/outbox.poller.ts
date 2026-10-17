import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import type { Message, Producer } from 'kafkajs';
import { DataSource, EntityManager, In, LessThan } from 'typeorm';
import {
  KAFKA_OPTIONS,
  KAFKA_PRODUCER,
  type KafkaModuleOptions,
} from '../kafka.constants';
import { OutboxEvent } from './outbox-event.entity';

const BATCH_SIZE = 100;
const RETENTION_DAYS = 7;
const PUBLISH_JOB = 'publish';
const CLEANUP_JOB = 'cleanup';

// Publishes outbox rows to Kafka (DOC 5.3, 6.8) as two BullMQ repeatable
// jobs: `publish` every second and `cleanup` daily at 03:00. With several
// replicas each tick runs once, and FOR UPDATE SKIP LOCKED keeps two
// pollers from sending the same rows anyway.
@Injectable()
export class OutboxPoller
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(OutboxPoller.name);
  private readonly queueName: string;
  private queue?: Queue;
  private worker?: Worker;
  private failing = false; // log a Kafka outage once, not every second

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    @Inject(KAFKA_PRODUCER) private readonly producer: Producer,
    @Inject(KAFKA_OPTIONS) options: KafkaModuleOptions,
  ) {
    this.queueName = `outbox-${options.serviceName}`;
  }

  async onApplicationBootstrap() {
    const url = this.config.getOrThrow<string>('REDIS_URL');
    // BullMQ needs maxRetriesPerRequest: null on its connections
    const connection = () => new Redis(url, { maxRetriesPerRequest: null });

    this.queue = new Queue(this.queueName, { connection: connection() });
    const jobOpts = { removeOnComplete: true, removeOnFail: 100 };
    await this.queue.upsertJobScheduler(
      'outbox-publish',
      { every: 1000 },
      { name: PUBLISH_JOB, opts: jobOpts },
    );
    await this.queue.upsertJobScheduler(
      'outbox-cleanup',
      { pattern: '0 3 * * *', tz: 'Asia/Baku' },
      { name: CLEANUP_JOB, opts: jobOpts },
    );

    this.worker = new Worker(this.queueName, (job) => this.run(job), {
      connection: connection(),
      concurrency: 1,
    });
    this.worker.on('failed', (job, error) =>
      this.logger.error(`Job ${job?.name} failed: ${error.message}`),
    );
  }

  async onApplicationShutdown() {
    await this.worker?.close();
    await this.queue?.close();
  }

  private run(job: Job): Promise<unknown> {
    return job.name === CLEANUP_JOB ? this.cleanup() : this.publishPending();
  }

  // Up to 100 oldest unpublished rows → one sendBatch → published_at.
  // On failure the rows stay unpublished (attempts++, last_error) and the
  // next tick retries them in the same order. Returns the number published.
  async publishPending(): Promise<number> {
    return this.dataSource.transaction(async (em) => {
      const rows = await em
        .createQueryBuilder(OutboxEvent, 'o')
        .where('o.publishedAt IS NULL')
        .orderBy('o.occurredAt', 'ASC')
        .limit(BATCH_SIZE)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getMany();
      if (rows.length === 0) return 0;

      const ids = rows.map((row) => row.id);
      try {
        await this.producer.sendBatch({ topicMessages: toTopicMessages(rows) });
      } catch (error) {
        await this.markFailed(em, ids, error as Error);
        return 0;
      }

      await em.update(
        OutboxEvent,
        { id: In(ids) },
        { publishedAt: new Date() },
      );
      if (this.failing) {
        this.failing = false;
        this.logger.log('Kafka reachable again — outbox publishing resumed');
      }
      return rows.length;
    });
  }

  private async markFailed(em: EntityManager, ids: string[], error: Error) {
    await em
      .createQueryBuilder()
      .update(OutboxEvent)
      .set({ attempts: () => 'attempts + 1', lastError: error.message })
      .whereInIds(ids)
      .execute();
    if (!this.failing) {
      this.failing = true;
      this.logger.error(
        `Publishing ${ids.length} outbox event(s) failed, retrying every second: ${error.message}`,
      );
    }
  }

  private async cleanup(): Promise<void> {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const { affected } = await this.dataSource.manager.delete(OutboxEvent, {
      publishedAt: LessThan(cutoff),
    });
    if (affected) this.logger.log(`Deleted ${affected} published outbox rows`);
  }
}

// Rows keep their order inside each topic. Key = aggregate id, so all
// events of one aggregate land in one partition and are consumed in order.
function toTopicMessages(rows: OutboxEvent[]) {
  const byTopic = new Map<string, Message[]>();
  for (const row of rows) {
    const messages = byTopic.get(row.topic) ?? [];
    messages.push({
      key: row.aggregateId,
      value: JSON.stringify(row.payload),
      headers: { 'event-type': row.eventType },
    });
    byTopic.set(row.topic, messages);
  }
  return [...byTopic].map(([topic, messages]) => ({ topic, messages }));
}
