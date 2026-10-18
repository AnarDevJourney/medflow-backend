import { Module } from '@nestjs/common';
import { join } from 'node:path';
import { createConfigModule, HealthModule, RedisModule } from '@medflow/common';
import { DatabaseModule } from '@medflow/database';
import { KafkaModule } from '@medflow/kafka';
import { envValidationSchema } from './config/env.validation';
import { HistoryModule } from './modules/history/history.module';
import { NotificationsModule } from './modules/notifications/notifications.module';

@Module({
  imports: [
    createConfigModule('notification-history-service', envValidationSchema),
    DatabaseModule.forRoot({
      migrations: [join(__dirname, 'database/migrations/*.js')],
    }),
    KafkaModule.forRoot({ serviceName: 'notification-history-service' }),
    RedisModule, // token block-list for the Socket.io handshake
    HealthModule,
    HistoryModule,
    NotificationsModule,
  ],
})
export class AppModule {}
