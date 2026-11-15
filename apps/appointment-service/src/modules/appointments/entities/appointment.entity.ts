import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum AppointmentType {
  CONSULTATION = 'CONSULTATION',
  FOLLOW_UP = 'FOLLOW_UP',
  CHECK_UP = 'CHECK_UP',
}

export enum AppointmentStatus {
  SCHEDULED = 'SCHEDULED',
  CHECKED_IN = 'CHECKED_IN',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  NO_SHOW = 'NO_SHOW',
}

// Statuses that hold the time slot (the exclusion constraints skip the others)
export const ACTIVE_STATUSES = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CHECKED_IN,
  AppointmentStatus.IN_PROGRESS,
  AppointmentStatus.COMPLETED,
];

// A booked time slot and its lifecycle (DOC 7.4). Patient, doctor and
// department are copied in at booking time: lists and the calendar render
// without asking other services.
@Entity('appointments')
export class Appointment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // patient-service id (no FK — other database)
  @Column({ type: 'uuid' })
  patientId: string;

  // auth user id of the doctor
  @Column({ type: 'uuid' })
  doctorId: string;

  @Column({ type: 'uuid' })
  departmentId: string;

  @Column({ type: 'varchar', length: 200 })
  patientName: string;

  @Column({ type: 'varchar', length: 20 })
  patientMrn: string;

  @Column({ type: 'varchar', length: 20 })
  patientPhone: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  patientEmail: string | null;

  @Column({ type: 'varchar', length: 200 })
  doctorName: string;

  @Column({ type: 'varchar', length: 100 })
  departmentName: string;

  @Column({ type: 'varchar', length: 10 })
  departmentCode: string;

  @Column({ type: 'timestamptz' })
  startsAt: Date;

  @Column({ type: 'timestamptz' })
  endsAt: Date;

  @Column({
    type: 'enum',
    enum: AppointmentType,
    enumName: 'appointment_type',
    default: AppointmentType.CONSULTATION,
  })
  type: AppointmentType;

  @Column({
    type: 'enum',
    enum: AppointmentStatus,
    enumName: 'appointment_status',
    default: AppointmentStatus.SCHEDULED,
  })
  status: AppointmentStatus;

  // Why the patient is coming
  @Column({ type: 'varchar', length: 500, nullable: true })
  reason: string | null;

  // Front-desk notes
  @Column({ type: 'text', nullable: true })
  notes: string | null;

  // Set when encounter.started is consumed (phase 8)
  @Column({ type: 'uuid', nullable: true })
  encounterId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  checkedInAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  checkedInBy: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  checkedInByName: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  cancelledBy: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  cancelledByName: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  cancellationReason: string | null;

  // auth user id of who booked
  @Column({ type: 'uuid' })
  createdBy: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  createdByName: string | null;

  // Last reschedule / edit
  @Column({ type: 'uuid', nullable: true })
  updatedBy: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  updatedByName: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
