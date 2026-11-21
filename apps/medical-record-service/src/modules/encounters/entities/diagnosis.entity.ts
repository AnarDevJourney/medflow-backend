import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum DiagnosisType {
  PRIMARY = 'PRIMARY',
  SECONDARY = 'SECONDARY',
}

// An ICD-10 diagnosis of a visit. At most one PRIMARY per visit (partial
// unique index); closing needs exactly one. Removable while the visit is open.
@Entity('diagnoses')
export class Diagnosis {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  encounterId: string;

  @Column({ type: 'uuid' })
  patientId: string;

  // null = an uncoded (free-text) diagnosis, always SECONDARY
  @Column({ type: 'varchar', length: 10, nullable: true })
  icd10Code: string | null;

  // copied from the ICD-10 title, the doctor may refine it
  @Column({ type: 'varchar', length: 255 })
  description: string;

  @Column({
    type: 'enum',
    enum: DiagnosisType,
    enumName: 'diagnosis_type',
    default: DiagnosisType.SECONDARY,
  })
  type: DiagnosisType;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
