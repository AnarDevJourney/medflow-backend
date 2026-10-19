import { MigrationInterface, QueryRunner } from 'typeorm';

// configurations_db: one sidebar configuration row per user. The row is
// created on the user's first change; until then the frontend uses defaults.
export class AddSidebarSettings1792800000000 implements MigrationInterface {
  name = 'AddSidebarSettings1792800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE sidebar_settings (
          user_id        uuid PRIMARY KEY,
          collapsed      boolean NOT NULL DEFAULT false,
          -- [{ id, name, collapsed, items: [pageKey] }]; NULL = default grouping
          groups         jsonb,
          favorites      jsonb   NOT NULL DEFAULT '[]',
          show_frequent  boolean NOT NULL DEFAULT true,
          show_recent    boolean NOT NULL DEFAULT true,
          -- { pageKey: { count, lastVisitedAt } } → "frequently used" + "recent"
          page_visits    jsonb   NOT NULL DEFAULT '{}',
          created_at     timestamptz NOT NULL DEFAULT now(),
          updated_at     timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT chk_sidebar_settings_groups      CHECK (groups IS NULL OR jsonb_typeof(groups) = 'array'),
          CONSTRAINT chk_sidebar_settings_favorites   CHECK (jsonb_typeof(favorites) = 'array'),
          CONSTRAINT chk_sidebar_settings_page_visits CHECK (jsonb_typeof(page_visits) = 'object')
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE sidebar_settings;`);
  }
}
