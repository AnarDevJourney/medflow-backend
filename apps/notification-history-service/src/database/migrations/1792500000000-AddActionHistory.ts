import { MigrationInterface, QueryRunner } from 'typeorm';

// notification_db — DATABASE.md §10: the append-only action_history.
// notifications and email_logs come with the notification / email parts of
// phase 4. No processed_events: the unique event_id is the idempotency key.
export class AddActionHistory1792500000000 implements MigrationInterface {
  name = 'AddActionHistory1792500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE action_history (
          id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          event_id       uuid NOT NULL,
          event_type     varchar(100) NOT NULL,
          source         varchar(50)  NOT NULL,
          actor_id       uuid,
          actor_name     varchar(200),
          actor_role     varchar(20),
          entity_type    varchar(30)  NOT NULL,
          entity_id      uuid NOT NULL,
          patient_id     uuid,
          summary        varchar(500) NOT NULL,
          metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
          correlation_id varchar(64),
          occurred_at    timestamptz NOT NULL,
          created_at     timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT uq_action_history_event UNIQUE (event_id)
      );
    `);
    await queryRunner.query(`
      CREATE INDEX idx_action_history_entity  ON action_history (entity_type, entity_id, occurred_at DESC);
      CREATE INDEX idx_action_history_patient ON action_history (patient_id, occurred_at DESC) WHERE patient_id IS NOT NULL;
      CREATE INDEX idx_action_history_actor   ON action_history (actor_id, occurred_at DESC);
      CREATE INDEX idx_action_history_time    ON action_history (occurred_at DESC);
      CREATE INDEX idx_action_history_type    ON action_history (event_type, occurred_at DESC);
    `);
    // Append-only: block UPDATE and DELETE at the database level
    await queryRunner.query(`
      CREATE FUNCTION forbid_action_history_change() RETURNS trigger AS $$
      BEGIN
          RAISE EXCEPTION 'action_history is append-only';
      END;
      $$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_action_history_immutable
          BEFORE UPDATE OR DELETE ON action_history
          FOR EACH ROW EXECUTE FUNCTION forbid_action_history_change();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE action_history;`);
    await queryRunner.query(`DROP FUNCTION forbid_action_history_change();`);
  }
}
