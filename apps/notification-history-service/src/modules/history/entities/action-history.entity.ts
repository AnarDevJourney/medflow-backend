import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Immutable audit trail of every business event (DATABASE.md §10). A
// trigger blocks UPDATE/DELETE; the summary never holds clinical values.
@Entity('action_history')
export class ActionHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  eventId: string;

  @Column({ type: 'varchar', length: 100 })
  eventType: string;

  @Column({ type: 'varchar', length: 50 })
  source: string;

  // NULL = system (scheduler, consumer, unauthenticated request)
  @Column({ type: 'uuid', nullable: true })
  actorId: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  actorName: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  actorRole: string | null;

  @Column({ type: 'varchar', length: 30 })
  entityType: string;

  @Column('uuid')
  entityId: string;

  // Set when the event concerns a patient → patient timeline
  @Column({ type: 'uuid', nullable: true })
  patientId: string | null;

  @Column({ type: 'varchar', length: 500 })
  summary: string;

  // Translatable form of the summary (historyEvents.<key> in the UI).
  // NULL on rows written before it existed → the UI shows `summary`.
  @Column({ type: 'varchar', length: 100, nullable: true })
  summaryKey: string | null;

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  summaryParams: Record<string, unknown>;

  // Ids, changed field NAMES, amounts — never clinical values or tokens
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  metadata: Record<string, unknown>;

  @Column({ type: 'varchar', length: 64, nullable: true })
  correlationId: string | null;

  // From the event, not the insert time
  @Column({ type: 'timestamptz' })
  occurredAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
