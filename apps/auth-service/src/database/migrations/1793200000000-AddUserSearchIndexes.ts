import { MigrationInterface, QueryRunner } from 'typeorm';

// Staff search (GET /users?search=) is ILIKE '%text%': a B-tree index can't
// serve a leading wildcard, trigram GIN indexes can. The expressions must
// match the query in UsersService.list exactly, or the planner skips them.
export class AddUserSearchIndexes1793200000000 implements MigrationInterface {
  name = 'AddUserSearchIndexes1793200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS pg_trgm;
      CREATE INDEX idx_users_full_name_trgm ON users USING gin ((first_name || ' ' || last_name) gin_trgm_ops);
      CREATE INDEX idx_users_email_trgm     ON users USING gin (email gin_trgm_ops);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // pg_trgm stays: other code may rely on it
    await queryRunner.query(`
      DROP INDEX idx_users_email_trgm;
      DROP INDEX idx_users_full_name_trgm;
    `);
  }
}
