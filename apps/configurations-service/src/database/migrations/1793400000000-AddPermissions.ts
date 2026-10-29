import { MigrationInterface, QueryRunner } from 'typeorm';

// configurations_db — permission-based access control.
// permissions = every code configurations-service has seen (the catalog in
// libs/common is synced into it on start: a new code gets its default
// roles once, a removed code is deleted with its grants).
// role_permissions = which role has which permission (edited by the admin).
// outbox_events (DATABASE.md §2) = role_permissions.updated events.
export class AddPermissions1793400000000 implements MigrationInterface {
  name = 'AddPermissions1793400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE permissions (
          code        varchar(100) PRIMARY KEY,
          created_at  timestamptz  NOT NULL DEFAULT now()
      );

      CREATE TABLE role_permissions (
          role        varchar(20)  NOT NULL,
          permission  varchar(100) NOT NULL REFERENCES permissions (code) ON DELETE CASCADE,
          granted_by  uuid,
          granted_at  timestamptz  NOT NULL DEFAULT now(),
          PRIMARY KEY (role, permission),
          CONSTRAINT chk_role_permissions_role
              CHECK (role IN ('ADMIN', 'DOCTOR', 'NURSE', 'RECEPTIONIST', 'ACCOUNTANT'))
      );

      CREATE TABLE outbox_events (
          id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          topic           varchar(100) NOT NULL,
          event_type      varchar(100) NOT NULL,
          aggregate_type  varchar(50)  NOT NULL,
          aggregate_id    uuid         NOT NULL,
          payload         jsonb        NOT NULL,
          occurred_at     timestamptz  NOT NULL DEFAULT now(),
          published_at    timestamptz,
          attempts        integer      NOT NULL DEFAULT 0,
          last_error      text
      );
      CREATE INDEX idx_outbox_unpublished ON outbox_events (occurred_at) WHERE published_at IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE outbox_events;
      DROP TABLE role_permissions;
      DROP TABLE permissions;
    `);
  }
}
