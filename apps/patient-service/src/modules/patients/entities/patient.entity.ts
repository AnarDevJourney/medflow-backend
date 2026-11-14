import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum Gender {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
}

export enum BloodType {
  A_POS = 'A_POS',
  A_NEG = 'A_NEG',
  B_POS = 'B_POS',
  B_NEG = 'B_NEG',
  AB_POS = 'AB_POS',
  AB_NEG = 'AB_NEG',
  O_POS = 'O_POS',
  O_NEG = 'O_NEG',
}

// The patient registry (DOC 7.3). MRN is the number staff say out loud;
// id is what every other service stores.
@Entity('patients')
export class Patient {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 'P-000123', from patient_mrn_seq
  @Column({ type: 'varchar', length: 20, unique: true })
  mrn: string;

  @Column({ type: 'varchar', length: 100 })
  firstName: string;

  @Column({ type: 'varchar', length: 100 })
  lastName: string;

  // ata adı
  @Column({ type: 'varchar', length: 100, nullable: true })
  fatherName: string | null;

  // Azerbaijani personal id (FIN), 7 upper-case letters / digits
  @Column({ type: 'char', length: 7, nullable: true, unique: true })
  finCode: string | null;

  // 'YYYY-MM-DD'
  @Column({ type: 'date' })
  dateOfBirth: string;

  @Column({ type: 'enum', enum: Gender, enumName: 'gender' })
  gender: Gender;

  @Column({
    type: 'enum',
    enum: BloodType,
    enumName: 'blood_type',
    nullable: true,
  })
  bloodType: BloodType | null;

  @Column({ type: 'varchar', length: 20 })
  phone: string;

  // Reminder / receipt emails
  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  emergencyContactName: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  emergencyContactPhone: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  emergencyContactRelation: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  // false = duplicate or deceased record (ADMIN)
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  // auth user id of the staff member who registered (no FK — other DB)
  @Column({ type: 'uuid' })
  registeredBy: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
