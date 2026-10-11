import { DynamicModule, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { buildDataSourceOptions } from './data-source-options';

export interface DatabaseModuleOptions {
  // Glob(s) of the app's compiled migrations, e.g.
  // join(__dirname, 'database/migrations/*.js')
  migrations: string[];
}

// Connects the app to its own database (DATABASE_URL). Entities are picked
// up from TypeOrmModule.forFeature() calls; pending migrations run on
// startup outside production (production runs them with `npm run db`).
@Module({})
export class DatabaseModule {
  static forRoot(options: DatabaseModuleOptions): DynamicModule {
    return {
      module: DatabaseModule,
      imports: [
        TypeOrmModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            ...buildDataSourceOptions(
              config.getOrThrow<string>('DATABASE_URL'),
            ),
            autoLoadEntities: true,
            migrations: options.migrations,
            migrationsRun: config.get<string>('NODE_ENV') !== 'production',
          }),
        }),
      ],
    };
  }
}
