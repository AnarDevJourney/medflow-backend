import { MigrationInterface, QueryRunner } from 'typeorm';

// staff_db — DATABASE.md §4 time_off. Our addition: an exclusion constraint,
// so two periods of one person can never overlap (end_date is inclusive,
// hence the '[]' range). btree_gist lets uuid equality join the gist index.
export class AddTimeOff1793800000000 implements MigrationInterface {
  name = 'AddTimeOff1793800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS btree_gist;

      CREATE TYPE time_off_type AS ENUM ('DAY_OFF', 'VACATION', 'SICK_LEAVE', 'TRAINING');

      CREATE TABLE time_off (
          id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          staff_member_id  uuid NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
          type             time_off_type NOT NULL,
          start_date       date NOT NULL,
          end_date         date NOT NULL,
          reason           varchar(255),
          created_by       uuid NOT NULL,
          created_at       timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT chk_time_off_range CHECK (end_date >= start_date),
          CONSTRAINT ex_time_off_overlap EXCLUDE USING gist (
              staff_member_id WITH =,
              daterange(start_date, end_date, '[]') WITH &&
          )
      );
      CREATE INDEX idx_time_off_staff_dates ON time_off (staff_member_id, start_date, end_date);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE time_off;
      DROP TYPE time_off_type;
    `);
  }
}
