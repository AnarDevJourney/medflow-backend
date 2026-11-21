import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { ColumnNumericTransformer } from '@medflow/database';

const numeric = new ColumnNumericTransformer();

// One set of measurements in a visit (DOC 6.3 step 6). A visit can have
// several (blood pressure again after the medicine). BMI is computed by
// the database from weight and height.
@Entity('vital_signs')
export class VitalSigns {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  encounterId: string;

  // denormalised for the patient's trend charts
  @Column({ type: 'uuid' })
  patientId: string;

  @Column({
    type: 'numeric',
    precision: 4,
    scale: 1,
    nullable: true,
    transformer: numeric,
  })
  temperatureC: number | null;

  @Column({ type: 'smallint', nullable: true })
  systolicBp: number | null;

  @Column({ type: 'smallint', nullable: true })
  diastolicBp: number | null;

  @Column({ type: 'smallint', nullable: true })
  heartRate: number | null;

  @Column({ type: 'smallint', nullable: true })
  respiratoryRate: number | null;

  @Column({ type: 'smallint', nullable: true })
  oxygenSaturation: number | null;

  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
    transformer: numeric,
  })
  weightKg: number | null;

  @Column({
    type: 'numeric',
    precision: 5,
    scale: 1,
    nullable: true,
    transformer: numeric,
  })
  heightCm: number | null;

  @Column({
    type: 'numeric',
    precision: 4,
    scale: 1,
    nullable: true,
    transformer: numeric,
    insert: false,
    update: false,
  })
  bmi: number | null;

  @Column({ type: 'uuid' })
  recordedBy: string;

  @Column({ type: 'varchar', length: 200 })
  recordedByName: string;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  recordedAt: Date;
}
