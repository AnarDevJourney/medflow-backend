import { MigrationInterface, QueryRunner } from 'typeorm';

// Data for the translated notification text (names, MRN, times) — the UI
// builds the sentence from notificationTypes.<TYPE> + these params, like
// action_history.summary_params. Older rows keep {} and show title/message.
export class AddNotificationParams1794400000000 implements MigrationInterface {
  name = 'AddNotificationParams1794400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE notifications ADD COLUMN params jsonb NOT NULL DEFAULT '{}'::jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE notifications DROP COLUMN params`);
  }
}
