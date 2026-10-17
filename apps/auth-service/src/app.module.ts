import { Module } from '@nestjs/common';
import { join } from 'node:path';
import { createConfigModule, HealthModule, RedisModule } from '@medflow/common';
import { Topics } from '@medflow/contracts';
import { DatabaseModule } from '@medflow/database';
import { KafkaModule, OutboxModule } from '@medflow/kafka';
import { AuthConfigModule } from './config/auth-config.module';
import { envValidationSchema } from './config/env.validation';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { AdminSeedService } from './seed/admin-seed.service';

@Module({
  imports: [
    createConfigModule('auth-service', envValidationSchema),
    AuthConfigModule,
    DatabaseModule.forRoot({
      migrations: [join(__dirname, 'database/migrations/*.js')],
    }),
    RedisModule,
    KafkaModule.forRoot({ serviceName: 'auth-service' }),
    OutboxModule.forRoot({ topic: Topics.AUTH }),
    UsersModule,
    AuthModule,
    HealthModule,
  ],
  providers: [AdminSeedService],
})
export class AppModule {}
