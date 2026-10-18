import { MigrationInterface, QueryRunner } from 'typeorm';

// notification_db — DATABASE.md §10: in-app notifications. Idempotency:
// one row per (event, recipient). email_logs comes with phase 4.3.
export class AddNotifications1792600000000 implements MigrationInterface {
  name = 'AddNotifications1792600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE notifications (
          id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          event_id      uuid NOT NULL,
          recipient_id  uuid NOT NULL,
          type          varchar(60)  NOT NULL,
          title         varchar(150) NOT NULL,
          message       varchar(500) NOT NULL,
          entity_type   varchar(30),
          entity_id     uuid,
          link          varchar(255),
          is_urgent     boolean NOT NULL DEFAULT false,
          is_read       boolean NOT NULL DEFAULT false,
          read_at       timestamptz,
          created_at    timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT uq_notifications_event_recipient UNIQUE (event_id, recipient_id)
      );
    `);
    await queryRunner.query(`
      CREATE INDEX idx_notifications_recipient ON notifications (recipient_id, created_at DESC);
      CREATE INDEX idx_notifications_unread    ON notifications (recipient_id) WHERE NOT is_read;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE notifications;`);
  }
}
