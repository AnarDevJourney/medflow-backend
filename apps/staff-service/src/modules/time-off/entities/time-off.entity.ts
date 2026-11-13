import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { StaffMember } from '../../staff/entities/staff-member.entity';

export enum TimeOffType {
  DAY_OFF = 'DAY_OFF',
  VACATION = 'VACATION',
  SICK_LEAVE = 'SICK_LEAVE',
  TRAINING = 'TRAINING',
}

// One leave period of a doctor (DOC 5.6). Calendar days, end inclusive.
// No edit: a wrong period is removed and added again (DOC 8.3).
@Entity('time_off')
export class TimeOff {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  staffMemberId: string;

  @ManyToOne(() => StaffMember, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'staff_member_id' })
  staffMember: StaffMember;

  @Column({ type: 'enum', enum: TimeOffType, enumName: 'time_off_type' })
  type: TimeOffType;

  // 'YYYY-MM-DD'
  @Column({ type: 'date' })
  startDate: string;

  @Column({ type: 'date' })
  endDate: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason: string | null;

  // auth user id of the admin who added it (no FK — other DB)
  @Column({ type: 'uuid' })
  createdBy: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
