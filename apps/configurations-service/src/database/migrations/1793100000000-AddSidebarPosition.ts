import { MigrationInterface, QueryRunner } from 'typeorm';

// sidebar_settings.position: the user can move the sidebar to the right
export class AddSidebarPosition1793100000000 implements MigrationInterface {
  name = 'AddSidebarPosition1793100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE sidebar_settings
        ADD COLUMN position varchar(5) NOT NULL DEFAULT 'left',
        ADD CONSTRAINT chk_sidebar_settings_position CHECK (position IN ('left', 'right'));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE sidebar_settings DROP COLUMN position;
    `);
  }
}
