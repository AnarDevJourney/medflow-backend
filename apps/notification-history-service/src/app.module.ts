import { Module } from '@nestjs/common';
import { join } from 'node:path';
import { createConfigModule, HealthModule } from '@medflow/common';
import { DatabaseModule } from '@medflow/database';
import { KafkaModule } from '@medflow/kafka';
import { envValidationSchema } from './config/env.validation';
import { HistoryModule } from './modules/history/history.module';

@Module({
  imports: [
    createConfigModule('notification-history-service', envValidationSchema),
    DatabaseModule.forRoot({
      migrations: [join(__dirname, 'database/migrations/*.js')],
    }),
    KafkaModule.forRoot({ serviceName: 'notification-history-service' }),
    HealthModule,
    HistoryModule,
  ],
})
export class AppModule {}
