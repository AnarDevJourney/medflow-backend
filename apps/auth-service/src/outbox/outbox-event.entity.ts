import { Column, Entity, PrimaryColumn } from 'typeorm';

// Transactional outbox (DATABASE.md §2). Written in the same transaction as
// the business change. TODO(phase 3): move to libs/kafka and add the poller
// that publishes unpublished rows to Kafka.
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
  payload: unknown;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  occurredAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;
}
