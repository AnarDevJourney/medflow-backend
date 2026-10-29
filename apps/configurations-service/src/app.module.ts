import { Module } from '@nestjs/common';
import { join } from 'node:path';
import type { Request } from 'express';
import { TableSyncModule } from 'tablesync-nest';
import {
  createConfigModule,
  HEADERS,
  HealthModule,
  RedisModule,
} from '@medflow/common';
import { Topics } from '@medflow/contracts';
import { DatabaseModule } from '@medflow/database';
import { KafkaModule, OutboxModule } from '@medflow/kafka';
import { envValidationSchema } from './config/env.validation';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { SidebarSettingsModule } from './modules/sidebar-settings/sidebar-settings.module';
import { ThemeSettingsModule } from './modules/theme-settings/theme-settings.module';

// Per-user UI configuration (sidebar, table and theme settings) and the
// role → permission matrix. Permission changes go out as
// configurations.events (outbox) and come back to refresh the Redis cache
// the gateway reads.
@Module({
  imports: [
    createConfigModule('configurations-service', envValidationSchema),
    DatabaseModule.forRoot({
      migrations: [join(__dirname, 'database/migrations/*.js')],
    }),
    RedisModule,
    KafkaModule.forRoot({ serviceName: 'configurations-service' }),
    OutboxModule.forRoot({ topic: Topics.CONFIGURATIONS }),
    HealthModule,
    PermissionsModule,
    SidebarSettingsModule,
    // Table settings: the tablesync-nest package (same endpoints as before).
    // The user id comes from the gateway's trusted header; none → 401.
    TableSyncModule.forRoot({
      path: 'configurations/tables',
      getUserId: (req: Request) => req.headers[HEADERS.USER_ID] as string,
    }),
    ThemeSettingsModule,
  ],
})
export class AppModule {}
