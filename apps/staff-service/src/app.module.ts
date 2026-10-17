import { Module } from '@nestjs/common';
import { join } from 'node:path';
import { createConfigModule, HealthModule } from '@medflow/common';
import { DatabaseModule } from '@medflow/database';
import { KafkaConsumerModule, KafkaModule } from '@medflow/kafka';
import { envValidationSchema } from './config/env.validation';
import { AuthEventsConsumer } from './consumers/auth-events.consumer';

@Module({
  imports: [
    createConfigModule('staff-service', envValidationSchema),
    DatabaseModule.forRoot({
      migrations: [join(__dirname, 'database/migrations/*.js')],
    }),
    KafkaModule.forRoot({ serviceName: 'staff-service' }),
    KafkaConsumerModule,
    HealthModule,
  ],
  providers: [AuthEventsConsumer],
})
export class AppModule {}
