import { DataSourceOptions } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';

// Base TypeORM options shared by the Nest runtime (DatabaseModule) and the
// TypeORM CLI (each app's database/data-source.ts). Schema changes happen
// only through migrations — never synchronize.
export function buildDataSourceOptions(url: string): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: false,
    migrationsTableName: 'typeorm_migrations',
    logging: ['error', 'warn', 'migration'],
  };
}
