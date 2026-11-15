import { MigrationInterface, QueryRunner } from 'typeorm';

// appointment_db — DATABASE.md §6 appointments + §2 outbox_events /
// processed_events (appointment-service publishes appointment.events and
// will consume patient.events / record.events).
export class AddAppointments1794100000000 implements MigrationInterface {
  name = 'AddAppointments1794100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS btree_gist; -- uuid "=" inside a gist exclusion

      CREATE TYPE appointment_type   AS ENUM ('CONSULTATION', 'FOLLOW_UP', 'CHECK_UP');
      CREATE TYPE appointment_status AS ENUM ('SCHEDULED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

      CREATE TABLE appointments (
          id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          patient_id           uuid NOT NULL,
          doctor_id            uuid NOT NULL,
          department_id        uuid NOT NULL,
          -- snapshots taken at booking, so lists need no cross-service calls
          patient_name         varchar(200) NOT NULL,
          patient_mrn          varchar(20)  NOT NULL,
          patient_phone        varchar(20)  NOT NULL,
          patient_email        varchar(255),
          doctor_name          varchar(200) NOT NULL,
          department_name      varchar(100) NOT NULL,
          department_code      varchar(10)  NOT NULL,
          starts_at            timestamptz NOT NULL,
          ends_at              timestamptz NOT NULL,
          type                 appointment_type   NOT NULL DEFAULT 'CONSULTATION',
          status               appointment_status NOT NULL DEFAULT 'SCHEDULED',
          reason               varchar(500),
          notes                text,
          encounter_id         uuid,
          checked_in_at        timestamptz,
          checked_in_by        uuid,
          started_at           timestamptz,
          completed_at         timestamptz,
          cancelled_at         timestamptz,
          cancelled_by         uuid,
          cancellation_reason  varchar(500),
          created_by           uuid NOT NULL,
          created_at           timestamptz NOT NULL DEFAULT now(),
          updated_at           timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT chk_appointments_time CHECK (ends_at > starts_at),
          CONSTRAINT chk_appointments_cancel CHECK (status <> 'CANCELLED' OR cancelled_at IS NOT NULL),
          -- No two active appointments of one doctor overlap — race-proof:
          -- the second of two parallel inserts fails with 23P01 → 409.
          -- Half-open [) ranges, so back-to-back slots are fine.
          CONSTRAINT excl_appointments_doctor_overlap EXCLUDE USING gist (
              doctor_id WITH =,
              tstzrange(starts_at, ends_at, '[)') WITH &&
          ) WHERE (status NOT IN ('CANCELLED', 'NO_SHOW')),
          -- Same for the patient: never in two places at once
          CONSTRAINT excl_appointments_patient_overlap EXCLUDE USING gist (
              patient_id WITH =,
              tstzrange(starts_at, ends_at, '[)') WITH &&
          ) WHERE (status NOT IN ('CANCELLED', 'NO_SHOW'))
      );
      CREATE INDEX idx_appointments_doctor_start ON appointments (doctor_id, starts_at);
      CREATE INDEX idx_appointments_patient_start ON appointments (patient_id, starts_at DESC);
      CREATE INDEX idx_appointments_status_start ON appointments (status, starts_at);
      CREATE INDEX idx_appointments_department_start ON appointments (department_id, starts_at);
      CREATE INDEX idx_appointments_created_at ON appointments (created_at DESC);

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

      CREATE TABLE processed_events (
          event_id      uuid PRIMARY KEY,
          event_type    varchar(100) NOT NULL,
          processed_at  timestamptz  NOT NULL DEFAULT now()
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE processed_events;
      DROP TABLE outbox_events;
      DROP TABLE appointments;
      DROP TYPE appointment_status;
      DROP TYPE appointment_type;
    `);
  }
}
