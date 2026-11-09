import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Role } from '@medflow/common';
import { Department } from '../../departments/entities/department.entity';

export enum StaffStatus {
  INVITED = 'INVITED',
  ACTIVE = 'ACTIVE',
  DEACTIVATED = 'DEACTIVATED',
}

// One row per auth user (DOC 5.6). Name, email, role and status are copies
// kept in sync by auth.events; the rest belongs to staff-service.
@Entity('staff_members')
export class StaffMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // auth users.id — THE staff id in every other service (doctor_id = user_id)
  @Column({ type: 'uuid', unique: true })
  userId: string;

  @Column({ type: 'varchar', length: 100 })
  firstName: string;

  @Column({ type: 'varchar', length: 100 })
  lastName: string;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ type: 'enum', enum: Role, enumName: 'staff_role' })
  role: Role;

  @Column({ type: 'enum', enum: StaffStatus, enumName: 'staff_status' })
  status: StaffStatus;

  @Column({ type: 'uuid', nullable: true })
  departmentId: string | null;

  @ManyToOne(() => Department, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'department_id' })
  department: Department | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  title: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  specialization: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true, unique: true })
  licenseNumber: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  // 'YYYY-MM-DD' — a calendar day, not a moment
  @Column({ type: 'date', nullable: true })
  hireDate: string | null;

  @Column({ type: 'text', nullable: true })
  bio: string | null;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
