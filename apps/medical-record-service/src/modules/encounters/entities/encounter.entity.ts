import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum EncounterStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

// One doctor visit, started from a CHECKED_IN appointment (DOC 7.5).
// Patient, doctor and department are copied from the appointment, so the
// visit page and the patient's record render without other services.
@Entity('encounters')
export class Encounter {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // appointment-service id (no FK — other database); one visit per booking
  @Column({ type: 'uuid' })
  appointmentId: string;

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

  // For encounter.closed → billing receipts (our addition)
  @Column({ type: 'varchar', length: 255, nullable: true })
  patientEmail: string | null;

  @Column({ type: 'varchar', length: 200 })
  doctorName: string;

  @Column({ type: 'varchar', length: 100 })
  departmentName: string;

  @Column({ type: 'varchar', length: 10 })
  departmentCode: string;

  // CONSULTATION | FOLLOW_UP | CHECK_UP — billing prices by it
  @Column({ type: 'varchar', length: 20 })
  appointmentType: string;

  @Column({
    type: 'enum',
    enum: EncounterStatus,
    enumName: 'encounter_status',
    default: EncounterStatus.OPEN,
  })
  status: EncounterStatus;

  @Column({ type: 'text', nullable: true })
  chiefComplaint: string | null;

  @Column({ type: 'text', nullable: true })
  examinationNotes: string | null;

  @Column({ type: 'text', nullable: true })
  treatmentPlan: string | null;

  @Column({ type: 'smallint', nullable: true })
  followUpInDays: number | null;

  @Column({ type: 'timestamptz' })
  startedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
