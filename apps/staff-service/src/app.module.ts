import { Module } from '@nestjs/common';
import { join } from 'node:path';
import { createConfigModule, HealthModule, RedisModule } from '@medflow/common';
import { Topics } from '@medflow/contracts';
import { DatabaseModule } from '@medflow/database';
import { KafkaConsumerModule, KafkaModule, OutboxModule } from '@medflow/kafka';
import { envValidationSchema } from './config/env.validation';
import { AuthEventsConsumer } from './consumers/auth-events.consumer';
import { DepartmentsModule } from './modules/departments/departments.module';
import { StaffModule } from './modules/staff/staff.module';

@Module({
  imports: [
    createConfigModule('staff-service', envValidationSchema),
    DatabaseModule.forRoot({
      migrations: [join(__dirname, 'database/migrations/*.js')],
    }),
    RedisModule,
    KafkaModule.forRoot({ serviceName: 'staff-service' }),
    OutboxModule.forRoot({ topic: Topics.STAFF }),
    KafkaConsumerModule,
    HealthModule,
    DepartmentsModule,
    StaffModule,
  ],
  providers: [AuthEventsConsumer],
})
export class AppModule {}
