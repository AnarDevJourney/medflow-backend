import { MigrationInterface, QueryRunner } from 'typeorm';

// When the 24-hours-before reminder went out: the reminder job runs once
// per appointment even if BullMQ delivers it twice or it is re-queued
export class AddReminderSentAt1794300000000 implements MigrationInterface {
  name = 'AddReminderSentAt1794300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE appointments ADD COLUMN reminder_sent_at timestamptz;
      -- the no-show sweep looks for old SCHEDULED rows
      CREATE INDEX idx_appointments_scheduled_end ON appointments (ends_at) WHERE status = 'SCHEDULED';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX idx_appointments_scheduled_end;
      ALTER TABLE appointments DROP COLUMN reminder_sent_at;
    `);
  }
}
