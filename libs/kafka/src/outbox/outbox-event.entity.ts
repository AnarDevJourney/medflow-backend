import { Column, Entity, PrimaryColumn } from 'typeorm';
import type { EventEnvelope } from '@medflow/contracts';

// Transactional outbox (DATABASE.md §2, DOC 5.3). Written in the same
// transaction as the business change; OutboxPoller publishes it to Kafka.
// Every producing service has this table in its own database.
@Entity('outbox_events')
export class OutboxEvent {
  @PrimaryColumn('uuid')
  id: string; // = envelope.eventId

  @Column({ type: 'varchar', length: 100 })
  topic: string;

  @Column({ type: 'varchar', length: 100 })
  eventType: string;

  @Column({ type: 'varchar', length: 50 })
  aggregateType: string;

  // Kafka message key
  @Column({ type: 'uuid' })
  aggregateId: string;

  @Column({ type: 'jsonb' })
  payload: EventEnvelope; // full envelope, sent as-is

  @Column({ type: 'timestamptz', default: () => 'now()' })
  occurredAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;
}
