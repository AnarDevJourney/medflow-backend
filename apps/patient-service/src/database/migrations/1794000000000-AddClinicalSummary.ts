import { MigrationInterface, QueryRunner } from 'typeorm';

// patient_db — DATABASE.md §5 patient_allergies + patient_conditions: the
// clinical summary shown on every visit. recorded_by_name is our addition:
// a snapshot of who wrote it (staff names live in staff-service).
export class AddClinicalSummary1794000000000 implements MigrationInterface {
  name = 'AddClinicalSummary1794000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE allergy_category AS ENUM ('DRUG', 'FOOD', 'ENVIRONMENTAL', 'OTHER');
      CREATE TYPE allergy_severity AS ENUM ('MILD', 'MODERATE', 'SEVERE');
      CREATE TYPE condition_status AS ENUM ('ACTIVE', 'RESOLVED');

      CREATE TABLE patient_allergies (
          id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          patient_id        uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
          allergen          varchar(100) NOT NULL,
          category          allergy_category NOT NULL,
          severity          allergy_severity NOT NULL,
          reaction          varchar(255),
          recorded_by       uuid NOT NULL,
          recorded_by_name  varchar(200),
          created_at        timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX uq_patient_allergies_allergen ON patient_allergies (patient_id, lower(allergen));

      CREATE TABLE patient_conditions (
          id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          patient_id        uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
          name              varchar(150) NOT NULL,
          icd10_code        varchar(10),
          diagnosed_on      date,
          status            condition_status NOT NULL DEFAULT 'ACTIVE',
          notes             text,
          recorded_by       uuid NOT NULL,
          recorded_by_name  varchar(200),
          created_at        timestamptz NOT NULL DEFAULT now(),
          updated_at        timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_patient_conditions_patient ON patient_conditions (patient_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE patient_conditions;
      DROP TABLE patient_allergies;
      DROP TYPE condition_status;
      DROP TYPE allergy_severity;
      DROP TYPE allergy_category;
    `);
  }
}
