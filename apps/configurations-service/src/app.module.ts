import { Module } from '@nestjs/common';
import { join } from 'node:path';
import { createConfigModule, HealthModule } from '@medflow/common';
import { DatabaseModule } from '@medflow/database';
import { envValidationSchema } from './config/env.validation';
import { SidebarSettingsModule } from './modules/sidebar-settings/sidebar-settings.module';
import { TableSettingsModule } from './modules/table-settings/table-settings.module';

// Per-user UI configuration: sidebar and table settings. Holds no
// domain data, so it neither publishes nor consumes Kafka events.
@Module({
  imports: [
    createConfigModule('configurations-service', envValidationSchema),
    DatabaseModule.forRoot({
      migrations: [join(__dirname, 'database/migrations/*.js')],
    }),
    HealthModule,
    SidebarSettingsModule,
    TableSettingsModule,
  ],
})
export class AppModule {}
