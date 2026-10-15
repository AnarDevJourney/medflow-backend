import { MigrationInterface, QueryRunner } from 'typeorm';

// auth_db schema — DATABASE.md §2 (outbox) and §3 (auth tables)
export class InitAuthSchema1792040000000 implements MigrationInterface {
  name = 'InitAuthSchema1792040000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE user_role   AS ENUM ('ADMIN', 'DOCTOR', 'NURSE', 'RECEPTIONIST', 'ACCOUNTANT');
      CREATE TYPE user_status AS ENUM ('INVITED', 'ACTIVE', 'DEACTIVATED');

      CREATE TABLE users (
          id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          email                varchar(255) NOT NULL,
          first_name           varchar(100) NOT NULL,
          last_name            varchar(100) NOT NULL,
          role                 user_role    NOT NULL,
          status               user_status  NOT NULL DEFAULT 'INVITED',
          password_hash        varchar(255),
          avatar_file_id       uuid,
          last_login_at        timestamptz,
          password_changed_at  timestamptz,
          created_by           uuid,
          created_at           timestamptz NOT NULL DEFAULT now(),
          updated_at           timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT uq_users_email UNIQUE (email),
          CONSTRAINT chk_users_email_lower CHECK (email = lower(email)),
          CONSTRAINT chk_users_active_has_password CHECK (status <> 'ACTIVE' OR password_hash IS NOT NULL)
      );
      CREATE INDEX idx_users_role_status ON users (role, status);

      CREATE TABLE invitations (
          id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash   char(64)    NOT NULL,
          expires_at   timestamptz NOT NULL,
          accepted_at  timestamptz,
          created_by   uuid NOT NULL,
          created_at   timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT uq_invitations_token UNIQUE (token_hash)
      );
      CREATE INDEX idx_invitations_user ON invitations (user_id);

      CREATE TABLE refresh_tokens (
          id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          family_id    uuid NOT NULL,
          token_hash   char(64)    NOT NULL,
          expires_at   timestamptz NOT NULL,
          revoked_at   timestamptz,
          replaced_by  uuid REFERENCES refresh_tokens(id),
          user_agent   varchar(500),
          ip_address   inet,
          created_at   timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT uq_refresh_tokens_hash UNIQUE (token_hash)
      );
      CREATE INDEX idx_refresh_tokens_user ON refresh_tokens (user_id);
      CREATE INDEX idx_refresh_tokens_family ON refresh_tokens (family_id);

      CREATE TABLE password_resets (
          id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash  char(64)    NOT NULL,
          expires_at  timestamptz NOT NULL,
          used_at     timestamptz,
          created_at  timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT uq_password_resets_token UNIQUE (token_hash)
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
      DROP TABLE password_resets;
      DROP TABLE refresh_tokens;
      DROP TABLE invitations;
      DROP TABLE users;
      DROP TYPE user_status;
      DROP TYPE user_role;
    `);
  }
}
