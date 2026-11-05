import { MigrationInterface, QueryRunner } from 'typeorm';

// staff_db — DATABASE.md §4 departments (+ §11 seed) and §2 outbox_events:
// staff-service starts publishing staff.events here.
export class AddDepartments1793500000000 implements MigrationInterface {
  name = 'AddDepartments1793500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE departments (
          id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          code         varchar(10)  NOT NULL,
          name         varchar(100) NOT NULL,
          description  text,
          location     varchar(100),
          phone        varchar(20),
          is_active    boolean      NOT NULL DEFAULT true,
          created_at   timestamptz  NOT NULL DEFAULT now(),
          updated_at   timestamptz  NOT NULL DEFAULT now(),
          CONSTRAINT uq_departments_code UNIQUE (code),
          CONSTRAINT uq_departments_name UNIQUE (name),
          CONSTRAINT chk_departments_code_upper CHECK (code = upper(code))
      );

      INSERT INTO departments (code, name, location) VALUES
          ('GEN',   'General Medicine', 'Building A, Floor 1'),
          ('CARD',  'Cardiology',       'Building A, Floor 2'),
          ('PED',   'Pediatrics',       'Building B, Floor 1'),
          ('NEURO', 'Neurology',        'Building A, Floor 3'),
          ('ORTH',  'Orthopedics',      'Building B, Floor 2');

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
      DROP TABLE departments;
    `);
  }
}
