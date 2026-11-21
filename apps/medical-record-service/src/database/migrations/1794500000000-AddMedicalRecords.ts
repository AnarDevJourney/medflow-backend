import { MigrationInterface, QueryRunner } from 'typeorm';
import { ICD10_SEED, LAB_TEST_SEED } from './seed/record-seed';

// record_db — DATABASE.md §7 (encounters, vitals, diagnoses, prescriptions,
// lab orders, reference data) + §2 outbox_events (publishes record.events).
// Our additions: encounters.patient_email (snapshot for encounter.closed →
// billing receipts) and idx_encounters_created_at (lists default to newest).
export class AddMedicalRecords1794500000000 implements MigrationInterface {
  name = 'AddMedicalRecords1794500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS pg_trgm; -- ICD-10 / lab test autocomplete

      CREATE TYPE encounter_status    AS ENUM ('OPEN', 'CLOSED');
      CREATE TYPE diagnosis_type      AS ENUM ('PRIMARY', 'SECONDARY');
      CREATE TYPE prescription_status AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');
      CREATE TYPE medication_route    AS ENUM ('ORAL', 'IV', 'IM', 'SC', 'TOPICAL', 'INHALATION', 'OTHER');
      CREATE TYPE lab_category        AS ENUM ('HEMATOLOGY', 'BIOCHEMISTRY', 'URINALYSIS', 'IMMUNOLOGY', 'MICROBIOLOGY');
      CREATE TYPE sample_type         AS ENUM ('BLOOD', 'URINE', 'STOOL', 'SWAB', 'OTHER');
      CREATE TYPE lab_priority        AS ENUM ('ROUTINE', 'URGENT');
      CREATE TYPE lab_order_status    AS ENUM ('ORDERED', 'SAMPLE_COLLECTED', 'COMPLETED', 'CANCELLED');

      CREATE TABLE icd10_codes (
          code      varchar(10)  PRIMARY KEY,
          title     varchar(255) NOT NULL,
          chapter   varchar(100) NOT NULL
      );
      CREATE INDEX idx_icd10_title_trgm ON icd10_codes USING gin (title gin_trgm_ops);

      CREATE TABLE lab_test_types (
          code             varchar(20)  PRIMARY KEY,
          name             varchar(150) NOT NULL,
          category         lab_category NOT NULL,
          sample_type      sample_type  NOT NULL,
          unit             varchar(30),
          reference_range  varchar(100),
          turnaround_hours smallint NOT NULL DEFAULT 24,
          is_active        boolean NOT NULL DEFAULT true
      );

      CREATE TABLE encounters (
          id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          appointment_id     uuid NOT NULL,
          patient_id         uuid NOT NULL,
          doctor_id          uuid NOT NULL,
          department_id      uuid NOT NULL,
          patient_name       varchar(200) NOT NULL,
          patient_mrn        varchar(20)  NOT NULL,
          patient_email      varchar(255),
          doctor_name        varchar(200) NOT NULL,
          department_name    varchar(100) NOT NULL,
          department_code    varchar(10)  NOT NULL,
          appointment_type   varchar(20)  NOT NULL,
          status             encounter_status NOT NULL DEFAULT 'OPEN',
          chief_complaint    text,
          examination_notes  text,
          treatment_plan     text,
          follow_up_in_days  smallint,
          started_at         timestamptz NOT NULL DEFAULT now(),
          closed_at          timestamptz,
          created_at         timestamptz NOT NULL DEFAULT now(),
          updated_at         timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT uq_encounters_appointment UNIQUE (appointment_id),
          CONSTRAINT chk_encounters_closed CHECK (status = 'OPEN' OR closed_at IS NOT NULL),
          CONSTRAINT chk_encounters_follow_up CHECK (follow_up_in_days IS NULL OR follow_up_in_days BETWEEN 1 AND 365)
      );
      CREATE INDEX idx_encounters_patient ON encounters (patient_id, started_at DESC);
      CREATE INDEX idx_encounters_doctor ON encounters (doctor_id, started_at DESC);
      CREATE INDEX idx_encounters_created_at ON encounters (created_at DESC);

      CREATE TABLE vital_signs (
          id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          encounter_id       uuid NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
          patient_id         uuid NOT NULL,
          temperature_c      numeric(4,1),
          systolic_bp        smallint,
          diastolic_bp       smallint,
          heart_rate         smallint,
          respiratory_rate   smallint,
          oxygen_saturation  smallint,
          weight_kg          numeric(5,2),
          height_cm          numeric(5,1),
          bmi                numeric(4,1) GENERATED ALWAYS AS (
                                CASE WHEN weight_kg IS NOT NULL AND height_cm > 0
                                     THEN round(weight_kg / ((height_cm / 100.0) ^ 2), 1) END
                             ) STORED,
          recorded_by        uuid NOT NULL,
          recorded_by_name   varchar(200) NOT NULL,
          recorded_at        timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT chk_vitals_temp CHECK (temperature_c IS NULL OR temperature_c BETWEEN 30 AND 45),
          CONSTRAINT chk_vitals_bp CHECK (systolic_bp IS NULL OR diastolic_bp IS NULL OR systolic_bp > diastolic_bp),
          CONSTRAINT chk_vitals_spo2 CHECK (oxygen_saturation IS NULL OR oxygen_saturation BETWEEN 0 AND 100),
          CONSTRAINT chk_vitals_hr CHECK (heart_rate IS NULL OR heart_rate BETWEEN 20 AND 250)
      );
      CREATE INDEX idx_vital_signs_patient ON vital_signs (patient_id, recorded_at DESC);
      CREATE INDEX idx_vital_signs_encounter ON vital_signs (encounter_id);

      CREATE TABLE diagnoses (
          id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          encounter_id  uuid NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
          patient_id    uuid NOT NULL,
          icd10_code    varchar(10)  NOT NULL REFERENCES icd10_codes(code),
          description   varchar(255) NOT NULL,
          type          diagnosis_type NOT NULL DEFAULT 'SECONDARY',
          notes         text,
          created_at    timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT uq_diagnoses_code UNIQUE (encounter_id, icd10_code)
      );
      CREATE UNIQUE INDEX uq_diagnoses_primary ON diagnoses (encounter_id) WHERE type = 'PRIMARY';
      CREATE INDEX idx_diagnoses_patient ON diagnoses (patient_id);
      CREATE INDEX idx_diagnoses_code_created ON diagnoses (icd10_code, created_at);

      CREATE TABLE prescriptions (
          id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          encounter_id  uuid NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
          patient_id    uuid NOT NULL,
          doctor_id     uuid NOT NULL,
          doctor_name   varchar(200) NOT NULL,
          status        prescription_status NOT NULL DEFAULT 'ACTIVE',
          notes         text,
          allergy_warning_acknowledged boolean NOT NULL DEFAULT false,
          created_at    timestamptz NOT NULL DEFAULT now(),
          updated_at    timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_prescriptions_patient ON prescriptions (patient_id, created_at DESC);

      CREATE TABLE prescription_items (
          id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          prescription_id  uuid NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
          medication_name  varchar(150) NOT NULL,
          dosage           varchar(50)  NOT NULL,
          frequency        varchar(100) NOT NULL,
          route            medication_route NOT NULL DEFAULT 'ORAL',
          duration_days    smallint NOT NULL,
          instructions     text,
          CONSTRAINT chk_prescription_items_duration CHECK (duration_days BETWEEN 1 AND 365)
      );
      CREATE INDEX idx_prescription_items_prescription ON prescription_items (prescription_id);

      CREATE TABLE lab_orders (
          id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          encounter_id         uuid NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
          patient_id           uuid NOT NULL,
          patient_name         varchar(200) NOT NULL,
          patient_mrn          varchar(20)  NOT NULL,
          department_id        uuid NOT NULL,
          ordered_by           uuid NOT NULL,
          ordered_by_name      varchar(200) NOT NULL,
          test_code            varchar(20)  NOT NULL REFERENCES lab_test_types(code),
          test_name            varchar(150) NOT NULL,
          priority             lab_priority NOT NULL DEFAULT 'ROUTINE',
          status               lab_order_status NOT NULL DEFAULT 'ORDERED',
          clinical_notes       text,
          sample_collected_at  timestamptz,
          sample_collected_by  uuid,
          result_value         varchar(100),
          result_summary       text,
          is_abnormal          boolean,
          result_file_id       uuid,
          completed_at         timestamptz,
          completed_by         uuid,
          cancelled_at         timestamptz,
          created_at           timestamptz NOT NULL DEFAULT now(),
          updated_at           timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT chk_lab_orders_completed CHECK (
              status <> 'COMPLETED' OR (completed_at IS NOT NULL AND is_abnormal IS NOT NULL)
          )
      );
      CREATE INDEX idx_lab_orders_queue ON lab_orders (department_id, status, priority, created_at)
          WHERE status IN ('ORDERED', 'SAMPLE_COLLECTED');
      CREATE INDEX idx_lab_orders_patient ON lab_orders (patient_id, created_at DESC);
      CREATE INDEX idx_lab_orders_encounter ON lab_orders (encounter_id);

      CREATE TABLE outbox_events (
          id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          topic           varchar(100) NOT NULL,
          event_type      varchar(100) NOT NULL,
          aggregate_type  varchar(50)  NOT NULL,
          aggregate_id    uuid         NOT NULL,
          payload         jsonb        NOT NULL,
          occurred_at     timestamptz  NOT NULL DEFAULT now(),
          published_at    timestamptz,
          attempts        integer      NOT NULL DEFAULT 0,
          last_error      text
      );
      CREATE INDEX idx_outbox_unpublished ON outbox_events (occurred_at) WHERE published_at IS NULL;
    `);

    // Reference data (DATABASE.md §9, ICD-10 extended to ~100 codes)
    for (const [code, title, chapter] of ICD10_SEED) {
      await queryRunner.query(
        'INSERT INTO icd10_codes (code, title, chapter) VALUES ($1, $2, $3)',
        [code, title, chapter],
      );
    }
    for (const t of LAB_TEST_SEED) {
      await queryRunner.query(
        `INSERT INTO lab_test_types (code, name, category, sample_type, unit, reference_range, turnaround_hours)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [t[0], t[1], t[2], t[3], t[4], t[5], t[6]],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE outbox_events;
      DROP TABLE lab_orders;
      DROP TABLE prescription_items;
      DROP TABLE prescriptions;
      DROP TABLE diagnoses;
      DROP TABLE vital_signs;
      DROP TABLE encounters;
      DROP TABLE lab_test_types;
      DROP TABLE icd10_codes;
      DROP TYPE lab_order_status;
      DROP TYPE lab_priority;
      DROP TYPE sample_type;
      DROP TYPE lab_category;
      DROP TYPE medication_route;
      DROP TYPE prescription_status;
      DROP TYPE diagnosis_type;
      DROP TYPE encounter_status;
    `);
  }
}
