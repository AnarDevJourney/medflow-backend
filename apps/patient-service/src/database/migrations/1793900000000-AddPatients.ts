import { MigrationInterface, QueryRunner } from 'typeorm';

// patient_db — DATABASE.md §5 patients (allergies + conditions come in 6.3)
// and §2 outbox_events: patient-service starts publishing patient.events.
export class AddPatients1793900000000 implements MigrationInterface {
  name = 'AddPatients1793900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS pg_trgm;

      CREATE TYPE gender     AS ENUM ('MALE', 'FEMALE');
      CREATE TYPE blood_type AS ENUM ('A_POS', 'A_NEG', 'B_POS', 'B_NEG', 'AB_POS', 'AB_NEG', 'O_POS', 'O_NEG');

      -- MRN = 'P-' + the number padded to 6 digits → P-000123 (built in code)
      CREATE SEQUENCE patient_mrn_seq START 1;

      CREATE TABLE patients (
          id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          mrn                         varchar(20)  NOT NULL,
          first_name                  varchar(100) NOT NULL,
          last_name                   varchar(100) NOT NULL,
          father_name                 varchar(100),
          fin_code                    char(7),
          date_of_birth               date NOT NULL,
          gender                      gender NOT NULL,
          blood_type                  blood_type,
          phone                       varchar(20) NOT NULL,
          email                       varchar(255),
          address                     text,
          emergency_contact_name      varchar(150),
          emergency_contact_phone     varchar(20),
          emergency_contact_relation  varchar(50),
          notes                       text,
          is_active                   boolean NOT NULL DEFAULT true,
          registered_by               uuid NOT NULL,
          created_at                  timestamptz NOT NULL DEFAULT now(),
          updated_at                  timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT uq_patients_mrn UNIQUE (mrn),
          CONSTRAINT uq_patients_fin UNIQUE (fin_code),
          CONSTRAINT chk_patients_fin_format CHECK (fin_code IS NULL OR fin_code ~ '^[A-Z0-9]{7}$'),
          CONSTRAINT chk_patients_dob CHECK (date_of_birth <= CURRENT_DATE)
      );
      -- Name search folds the letters that names are spelled with in
      -- different ways: Məmmədova = Mammadova (passport) = Mamedova (Russian),
      -- İsmayılova = Ismailova, Quliyev = Guliyev. Both the names and the
      -- search text are folded (patient.mapper.ts searchKey = same mapping).
      CREATE FUNCTION patient_search_name(first_name text, last_name text) RETURNS text
          LANGUAGE sql IMMUTABLE PARALLEL SAFE
          AS $fn$ SELECT lower(translate(first_name || ' ' || last_name, 'ƏəAaIıİYyÖöÜüŞşÇçĞğQq', 'eeeeiiiiioouussccgggg')) $fn$;
      CREATE INDEX idx_patients_name_trgm ON patients USING gin (patient_search_name(first_name, last_name) gin_trgm_ops);
      CREATE INDEX idx_patients_phone ON patients (phone);
      CREATE INDEX idx_patients_created_at ON patients (created_at DESC);

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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE outbox_events;
      DROP TABLE patients;
      DROP FUNCTION patient_search_name(text, text);
      DROP SEQUENCE patient_mrn_seq;
      DROP TYPE blood_type;
      DROP TYPE gender;
    `);
  }
}
