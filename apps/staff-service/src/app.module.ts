import { Module } from '@nestjs/common';
import { join } from 'node:path';
import { createConfigModule, HealthModule } from '@medflow/common';
import { DatabaseModule } from '@medflow/database';
import { envValidationSchema } from './config/env.validation';

@Module({
  imports: [
    createConfigModule('staff-service', envValidationSchema),
    DatabaseModule.forRoot({
      migrations: [join(__dirname, 'database/migrations/*.js')],
    }),
    HealthModule,
  ],
})
export class AppModule {}
