import { MigrationInterface, QueryRunner } from 'typeorm';

// configurations_db: one row per (user, table). A NULL column means "the
// table's default" — only the frontend knows a table's columns and defaults.
export class AddTableSettings1792900000000 implements MigrationInterface {
  name = 'AddTableSettings1792900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE table_settings (
          user_id     uuid NOT NULL,
          table_key   varchar(60) NOT NULL,
          -- [{ key, visible, width, pinned }] in display order
          columns     jsonb,
          density     varchar(20),
          view        varchar(40),
          created_at  timestamptz NOT NULL DEFAULT now(),
          updated_at  timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT pk_table_settings PRIMARY KEY (user_id, table_key),
          CONSTRAINT chk_table_settings_columns CHECK (columns IS NULL OR jsonb_typeof(columns) = 'array'),
          CONSTRAINT chk_table_settings_density CHECK (density IN ('compact', 'comfortable'))
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE table_settings;`);
  }
}
