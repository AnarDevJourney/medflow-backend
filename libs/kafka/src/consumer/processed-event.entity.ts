import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

// Consumer idempotency (DATABASE.md §2, DOC 5.4): the event id is inserted
// in the same transaction as the handler's side effects; a duplicate
// delivery finds its id already here and is skipped.
@Entity('processed_events')
export class ProcessedEvent {
  @PrimaryColumn('uuid')
  eventId: string;

  @Column({ type: 'varchar', length: 100 })
  eventType: string;

  @CreateDateColumn({ type: 'timestamptz' })
  processedAt: Date;
}
