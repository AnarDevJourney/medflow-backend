import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Patient } from './patient.entity';

export enum ConditionStatus {
  ACTIVE = 'ACTIVE',
  RESOLVED = 'RESOLVED',
}

// One chronic condition (DOC 7.3): 'Type 2 diabetes mellitus', E11
@Entity('patient_conditions')
export class PatientCondition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  patientId: string;

  @ManyToOne(() => Patient, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'patient_id' })
  patient: Patient;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  icd10Code: string | null;

  // 'YYYY-MM-DD'
  @Column({ type: 'date', nullable: true })
  diagnosedOn: string | null;

  @Column({
    type: 'enum',
    enum: ConditionStatus,
    enumName: 'condition_status',
    default: ConditionStatus.ACTIVE,
  })
  status: ConditionStatus;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'uuid' })
  recordedBy: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  recordedByName: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
