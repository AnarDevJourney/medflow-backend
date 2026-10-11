import { DynamicModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { ObjectSchema } from 'joi';

// Loads apps/<app>/.env (app-specific: PORT, DATABASE_URL) first, then the
// shared root .env. Real environment variables (Docker) always win.
// The app refuses to start if validation fails.
export function createConfigModule(
  appName: string,
  validationSchema: ObjectSchema,
): Promise<DynamicModule> {
  return ConfigModule.forRoot({
    isGlobal: true,
    cache: true,
    envFilePath: [`apps/${appName}/.env`, '.env'],
    // @nestjs/config 12 takes any Standard Schema; Joi 18 implements it.
    // abortEarly: false → report every missing variable at once.
    validationSchema: validationSchema.prefs({ abortEarly: false }),
  });
}
