import { Module } from '@nestjs/common';
import { join } from 'node:path';
import { createConfigModule, HealthModule, RedisModule } from '@medflow/common';
import { Topics } from '@medflow/contracts';
import { DatabaseModule } from '@medflow/database';
import { KafkaModule, OutboxModule } from '@medflow/kafka';
import { envValidationSchema } from './config/env.validation';
import { EncountersModule } from './modules/encounters/encounters.module';

@Module({
  imports: [
    createConfigModule('medical-record-service', envValidationSchema),
    DatabaseModule.forRoot({
      migrations: [join(__dirname, 'database/migrations/*.js')],
    }),
    RedisModule,
    KafkaModule.forRoot({ serviceName: 'medical-record-service' }),
    OutboxModule.forRoot({ topic: Topics.RECORD }),
    HealthModule,
    EncountersModule,
  ],
})
export class AppModule {}
