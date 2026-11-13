import { MigrationInterface, QueryRunner } from 'typeorm';

// staff_db — DATABASE.md §4 doctor_schedules. One row per working weekday
// (ISO 1 = Monday … 7 = Sunday); a missing day = not working.
export class AddDoctorSchedules1793700000000 implements MigrationInterface {
  name = 'AddDoctorSchedules1793700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE doctor_schedules (
          id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          staff_member_id  uuid     NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
          day_of_week      smallint NOT NULL,
          start_time       time     NOT NULL,
          end_time         time     NOT NULL,
          slot_minutes     smallint NOT NULL DEFAULT 30,
          is_active        boolean  NOT NULL DEFAULT true,
          created_at       timestamptz NOT NULL DEFAULT now(),
          updated_at       timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT uq_doctor_schedules_day UNIQUE (staff_member_id, day_of_week),
          CONSTRAINT chk_doctor_schedules_dow CHECK (day_of_week BETWEEN 1 AND 7),
          CONSTRAINT chk_doctor_schedules_time CHECK (end_time > start_time),
          CONSTRAINT chk_doctor_schedules_slot CHECK (slot_minutes IN (10, 15, 20, 30, 45, 60))
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE doctor_schedules;`);
  }
}
