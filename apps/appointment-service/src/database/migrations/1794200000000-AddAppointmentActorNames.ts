import { MigrationInterface, QueryRunner } from 'typeorm';

// Who booked / checked in / cancelled / last changed an appointment, as
// names: the UI never shows user ids, and appointment-service cannot look
// names up (other database). Snapshots like patient allergies'
// recorded_by_name. Older rows keep NULL.
export class AddAppointmentActorNames1794200000000 implements MigrationInterface {
  name = 'AddAppointmentActorNames1794200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE appointments
          ADD COLUMN created_by_name    varchar(200),
          ADD COLUMN checked_in_by_name varchar(200),
          ADD COLUMN cancelled_by_name  varchar(200),
          ADD COLUMN updated_by         uuid,
          ADD COLUMN updated_by_name    varchar(200);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE appointments
          DROP COLUMN updated_by_name,
          DROP COLUMN updated_by,
          DROP COLUMN cancelled_by_name,
          DROP COLUMN checked_in_by_name,
          DROP COLUMN created_by_name;
    `);
  }
}
