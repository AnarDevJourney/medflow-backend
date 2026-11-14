import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Patient } from './patient.entity';

export enum AllergyCategory {
  DRUG = 'DRUG',
  FOOD = 'FOOD',
  ENVIRONMENTAL = 'ENVIRONMENTAL',
  OTHER = 'OTHER',
}

// Declared mild → severe: Postgres sorts the enum in this order
export enum AllergySeverity {
  MILD = 'MILD',
  MODERATE = 'MODERATE',
  SEVERE = 'SEVERE',
}

// One known allergy (DOC 7.3). Unique per patient, case-insensitive.
// Editable like a condition (our addition to DOC 8.4): severity and
// reactions change over time.
@Entity('patient_allergies')
export class PatientAllergy {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  patientId: string;

  @ManyToOne(() => Patient, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'patient_id' })
  patient: Patient;

  // 'Penicillin', 'Peanuts'
  @Column({ type: 'varchar', length: 100 })
  allergen: string;

  @Column({ type: 'enum', enum: AllergyCategory, enumName: 'allergy_category' })
  category: AllergyCategory;

  @Column({ type: 'enum', enum: AllergySeverity, enumName: 'allergy_severity' })
  severity: AllergySeverity;

  // 'Skin rash', 'Anaphylaxis'
  @Column({ type: 'varchar', length: 255, nullable: true })
  reaction: string | null;

  // auth user id (no FK — other DB) + a snapshot of the name
  @Column({ type: 'uuid' })
  recordedBy: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  recordedByName: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
