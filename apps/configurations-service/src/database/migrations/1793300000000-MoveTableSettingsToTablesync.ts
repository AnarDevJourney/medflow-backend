import { MigrationInterface, QueryRunner } from 'typeorm';

// Table settings now come from the tablesync-nest package, which keeps them
// in its own table (same columns, user_id as varchar). Rows are copied over,
// so nobody loses their layout.
export class MoveTableSettingsToTablesync1793300000000 implements MigrationInterface {
  name = 'MoveTableSettingsToTablesync1793300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Same table as tablesync-nest's CreateTablesyncSettings1793300000000
    await queryRunner.query(`
      CREATE TABLE tablesync_settings (
          user_id     varchar(100) NOT NULL,
          table_key   varchar(60) NOT NULL,
          columns     jsonb,
          density     varchar(20),
          view        varchar(40),
          created_at  timestamptz NOT NULL DEFAULT now(),
          updated_at  timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT pk_tablesync_settings PRIMARY KEY (user_id, table_key),
          CONSTRAINT chk_tablesync_settings_columns CHECK (columns IS NULL OR jsonb_typeof(columns) = 'array'),
          CONSTRAINT chk_tablesync_settings_density CHECK (density IN ('compact', 'comfortable'))
      );
    `);
    await queryRunner.query(`
      INSERT INTO tablesync_settings
        (user_id, table_key, columns, density, view, created_at, updated_at)
      SELECT user_id::text, table_key, columns, density, view, created_at, updated_at
      FROM table_settings;
    `);
    await queryRunner.query(`DROP TABLE table_settings;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE table_settings (
          user_id     uuid NOT NULL,
          table_key   varchar(60) NOT NULL,
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
    await queryRunner.query(`
      INSERT INTO table_settings
        (user_id, table_key, columns, density, view, created_at, updated_at)
      SELECT user_id::uuid, table_key, columns, density, view, created_at, updated_at
      FROM tablesync_settings;
    `);
    await queryRunner.query(`DROP TABLE tablesync_settings;`);
  }
}
