import { Module } from '@nestjs/common';
import { join } from 'node:path';
import { createConfigModule, HealthModule, RedisModule } from '@medflow/common';
import { Topics } from '@medflow/contracts';
import { DatabaseModule } from '@medflow/database';
import { KafkaModule, OutboxModule } from '@medflow/kafka';
import { envValidationSchema } from './config/env.validation';
import { AppointmentsModule } from './modules/appointments/appointments.module';

@Module({
  imports: [
    createConfigModule('appointment-service', envValidationSchema),
    DatabaseModule.forRoot({
      migrations: [join(__dirname, 'database/migrations/*.js')],
    }),
    RedisModule,
    KafkaModule.forRoot({ serviceName: 'appointment-service' }),
    OutboxModule.forRoot({ topic: Topics.APPOINTMENT }),
    HealthModule,
    AppointmentsModule,
  ],
})
export class AppModule {}
