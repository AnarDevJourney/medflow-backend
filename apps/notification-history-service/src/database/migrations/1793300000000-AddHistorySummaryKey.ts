import { MigrationInterface, QueryRunner } from 'typeorm';

// The summary is an English sentence. Its key + params let the UI show it
// in the reader's language. Old rows keep summary_key NULL (the log is
// append-only, they are not rewritten) and the UI falls back to `summary`.
export class AddHistorySummaryKey1793300000000 implements MigrationInterface {
  name = 'AddHistorySummaryKey1793300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE action_history
        ADD COLUMN summary_key    varchar(100),
        ADD COLUMN summary_params jsonb NOT NULL DEFAULT '{}';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE action_history
        DROP COLUMN summary_params,
        DROP COLUMN summary_key;
    `);
  }
}
