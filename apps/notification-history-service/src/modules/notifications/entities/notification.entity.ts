import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

// In-app notification of one staff member (DATABASE.md §10). One row per
// (event, recipient), so a redelivered event never notifies twice.
@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // The Kafka event that caused it
  @Column('uuid')
  eventId: string;

  // Staff user id (auth)
  @Column('uuid')
  recipientId: string;

  // 'SESSION_REVOKED', 'APPOINTMENT_CHECKED_IN', 'LAB_RESULT_READY', …
  @Column({ type: 'varchar', length: 60 })
  type: string;

  @Column({ type: 'varchar', length: 150 })
  title: string;

  @Column({ type: 'varchar', length: 500 })
  message: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  entityType: string | null;

  @Column({ type: 'uuid', nullable: true })
  entityId: string | null;

  // Frontend route, e.g. '/lab-orders/<id>'
  @Column({ type: 'varchar', length: 255, nullable: true })
  link: string | null;

  @Column({ type: 'boolean', default: false })
  isUrgent: boolean;

  @Column({ type: 'boolean', default: false })
  isRead: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
