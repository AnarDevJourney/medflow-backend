import { MigrationInterface, QueryRunner } from 'typeorm';

// staff_db — DATABASE.md §4 staff_members. Our addition: `status`, a copy of
// the auth account status (INVITED / ACTIVE / DEACTIVATED), so the staff
// page can show and filter it without asking auth-service. is_active stays
// (DOC): false only when DEACTIVATED. Trigram indexes for the directory
// search, like auth's users.
export class AddStaffMembers1793600000000 implements MigrationInterface {
  name = 'AddStaffMembers1793600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS pg_trgm;

      CREATE TYPE staff_role   AS ENUM ('ADMIN', 'DOCTOR', 'NURSE', 'RECEPTIONIST', 'ACCOUNTANT');
      CREATE TYPE staff_status AS ENUM ('INVITED', 'ACTIVE', 'DEACTIVATED');

      CREATE TABLE staff_members (
          id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id         uuid         NOT NULL,
          first_name      varchar(100) NOT NULL,
          last_name       varchar(100) NOT NULL,
          email           varchar(255) NOT NULL,
          role            staff_role   NOT NULL,
          status          staff_status NOT NULL DEFAULT 'INVITED',
          department_id   uuid REFERENCES departments(id) ON DELETE SET NULL,
          title           varchar(100),
          specialization  varchar(100),
          license_number  varchar(50),
          phone           varchar(20),
          hire_date       date,
          bio             text,
          is_active       boolean      NOT NULL DEFAULT true,
          created_at      timestamptz  NOT NULL DEFAULT now(),
          updated_at      timestamptz  NOT NULL DEFAULT now(),
          CONSTRAINT uq_staff_members_user UNIQUE (user_id),
          CONSTRAINT uq_staff_members_license UNIQUE (license_number)
      );
      CREATE INDEX idx_staff_members_role_dept ON staff_members (role, department_id) WHERE is_active;
      CREATE INDEX idx_staff_members_department ON staff_members (department_id);
      CREATE INDEX idx_staff_members_full_name_trgm ON staff_members USING gin ((first_name || ' ' || last_name) gin_trgm_ops);
      CREATE INDEX idx_staff_members_email_trgm     ON staff_members USING gin (email gin_trgm_ops);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE staff_members;
      DROP TYPE staff_status;
      DROP TYPE staff_role;
    `);
  }
}
