import { Module } from '@nestjs/common';
import { join } from 'node:path';
import { createConfigModule, HealthModule, RedisModule } from '@medflow/common';
import { Topics } from '@medflow/contracts';
import { DatabaseModule } from '@medflow/database';
import { KafkaModule, OutboxModule } from '@medflow/kafka';
import { envValidationSchema } from './config/env.validation';
import { PatientsModule } from './modules/patients/patients.module';

@Module({
  imports: [
    createConfigModule('patient-service', envValidationSchema),
    DatabaseModule.forRoot({
      migrations: [join(__dirname, 'database/migrations/*.js')],
    }),
    RedisModule,
    KafkaModule.forRoot({ serviceName: 'patient-service' }),
    OutboxModule.forRoot({ topic: Topics.PATIENT }),
    HealthModule,
    PatientsModule,
  ],
})
export class AppModule {}
