import { MigrationInterface, QueryRunner } from 'typeorm';

// staff_db — DATABASE.md §2: consumer idempotency for auth.events.
export class AddProcessedEvents1792400000000 implements MigrationInterface {
  name = 'AddProcessedEvents1792400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE processed_events (
          event_id      uuid PRIMARY KEY,
          event_type    varchar(100) NOT NULL,
          processed_at  timestamptz  NOT NULL DEFAULT now()
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE processed_events;`);
  }
}
