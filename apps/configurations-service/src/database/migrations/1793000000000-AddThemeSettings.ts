import { MigrationInterface, QueryRunner } from 'typeorm';

// configurations_db: one appearance row per user. NULL = the app default
// for that setting (defaults live in the frontend's theme builder).
export class AddThemeSettings1793000000000 implements MigrationInterface {
  name = 'AddThemeSettings1793000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE theme_settings (
          user_id        uuid PRIMARY KEY,
          mode           varchar(10),
          palette        varchar(40),
          primary_color  varchar(7),
          sidebar_style  varchar(40),
          density        varchar(20),
          motion         varchar(10),
          created_at     timestamptz NOT NULL DEFAULT now(),
          updated_at     timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT chk_theme_settings_mode    CHECK (mode IN ('system', 'light', 'dark')),
          CONSTRAINT chk_theme_settings_primary CHECK (primary_color ~ '^#[0-9a-f]{6}$'),
          CONSTRAINT chk_theme_settings_density CHECK (density IN ('compact', 'comfortable', 'spacious')),
          CONSTRAINT chk_theme_settings_motion  CHECK (motion IN ('system', 'reduced', 'full'))
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE theme_settings;`);
  }
}
