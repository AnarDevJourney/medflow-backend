import { Module } from '@nestjs/common';
import { join } from 'node:path';
import type { Request } from 'express';
import { TableSyncModule } from 'tablesync-nest';
import { createConfigModule, HEADERS, HealthModule } from '@medflow/common';
import { DatabaseModule } from '@medflow/database';
import { envValidationSchema } from './config/env.validation';
import { SidebarSettingsModule } from './modules/sidebar-settings/sidebar-settings.module';
import { ThemeSettingsModule } from './modules/theme-settings/theme-settings.module';

// Per-user UI configuration: sidebar, table and theme settings. Holds no
// domain data, so it neither publishes nor consumes Kafka events.
@Module({
  imports: [
    createConfigModule('configurations-service', envValidationSchema),
    DatabaseModule.forRoot({
      migrations: [join(__dirname, 'database/migrations/*.js')],
    }),
    HealthModule,
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
