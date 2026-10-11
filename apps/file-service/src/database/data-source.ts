import { config } from 'dotenv';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '@medflow/database';

// Used only by the TypeORM CLI (npm run db -- file-service <command>)
config({ path: ['apps/file-service/.env', '.env'], quiet: true });

export default new DataSource({
  ...buildDataSourceOptions(process.env.DATABASE_URL!),
  entities: [join(__dirname, '../**/*.entity.ts')],
  migrations: [join(__dirname, 'migrations/*.ts')],
});
