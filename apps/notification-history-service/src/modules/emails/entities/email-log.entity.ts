import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum EmailStatus {
  QUEUED = 'QUEUED',
  SENT = 'SENT',
  FAILED = 'FAILED',
}

// Every email the system tried to send (DATABASE.md §10). Written QUEUED by
// EmailConsumer, moved to SENT / FAILED by EmailWorker. No body: it may
// contain an invite / reset link.
@Entity('email_logs')
export class EmailLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  eventId: string;

  @Column({ type: 'varchar', length: 255 })
  recipientEmail: string;

  // 'staff-invite', 'password-reset', …
  @Column({ type: 'varchar', length: 60 })
  template: string;

  @Column({ type: 'varchar', length: 255 })
  subject: string;

  @Column({
    type: 'enum',
    enum: EmailStatus,
    enumName: 'email_status',
    default: EmailStatus.QUEUED,
  })
  status: EmailStatus;

  @Column({ type: 'smallint', default: 0 })
  attempts: number;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
