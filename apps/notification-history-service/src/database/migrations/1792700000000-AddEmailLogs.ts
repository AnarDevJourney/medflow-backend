import { MigrationInterface, QueryRunner } from 'typeorm';

// notification_db — DATABASE.md §10: every email the system tried to send.
// One row per (event, template, recipient); the body is never stored (it
// may hold an invite / reset link).
export class AddEmailLogs1792700000000 implements MigrationInterface {
  name = 'AddEmailLogs1792700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE email_status AS ENUM ('QUEUED', 'SENT', 'FAILED');`,
    );
    await queryRunner.query(`
      CREATE TABLE email_logs (
          id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          event_id         uuid NOT NULL,
          recipient_email  varchar(255) NOT NULL,
          template         varchar(60)  NOT NULL,
          subject          varchar(255) NOT NULL,
          status           email_status NOT NULL DEFAULT 'QUEUED',
          attempts         smallint NOT NULL DEFAULT 0,
          error            text,
          sent_at          timestamptz,
          created_at       timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT uq_email_logs_event_template UNIQUE (event_id, template, recipient_email)
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_email_logs_status ON email_logs (status, created_at DESC);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE email_logs;`);
    await queryRunner.query(`DROP TYPE email_status;`);
  }
}
