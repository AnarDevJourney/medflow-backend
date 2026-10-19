import { Module } from '@nestjs/common';
import { join } from 'node:path';
import { createConfigModule, HealthModule } from '@medflow/common';
import { DatabaseModule } from '@medflow/database';
import { envValidationSchema } from './config/env.validation';
import { SidebarSettingsModule } from './modules/sidebar-settings/sidebar-settings.module';

// Per-user UI configuration (sidebar now, table settings next). Holds no
// domain data, so it neither publishes nor consumes Kafka events.
@Module({
  imports: [
    createConfigModule('configurations-service', envValidationSchema),
    DatabaseModule.forRoot({
      migrations: [join(__dirname, 'database/migrations/*.js')],
    }),
    HealthModule,
    SidebarSettingsModule,
  ],
})
export class AppModule {}
