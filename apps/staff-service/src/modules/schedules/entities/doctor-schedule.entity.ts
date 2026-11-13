import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { StaffMember } from '../../staff/entities/staff-member.entity';

// One working weekday of a doctor (DOC 5.6). A missing day = not working.
@Entity('doctor_schedules')
export class DoctorSchedule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  staffMemberId: string;

  @ManyToOne(() => StaffMember, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'staff_member_id' })
  staffMember: StaffMember;

  // ISO: 1 = Monday … 7 = Sunday
  @Column({ type: 'smallint' })
  dayOfWeek: number;

  // Postgres returns 'HH:MM:SS'; the API speaks 'HH:mm'
  @Column({ type: 'time' })
  startTime: string;

  @Column({ type: 'time' })
  endTime: string;

  @Column({ type: 'smallint', default: 30 })
  slotMinutes: number;

  // Always true for now: a day off is a missing row (kept from the DOC)
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
