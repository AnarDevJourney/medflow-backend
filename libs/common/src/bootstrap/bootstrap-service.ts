import { Logger, RequestMethod, Type } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { API_PREFIX } from '../constants/headers';
import { HttpExceptionFilter } from '../filters/http-exception.filter';
import { InternalKeyGuard } from '../guards/internal-key.guard';
import { RolesGuard } from '../guards/roles.guard';
import { TransformInterceptor } from '../interceptors/transform.interceptor';
import { requestIdMiddleware } from '../middleware/request-id.middleware';
import { createValidationPipe } from '../pipes/validation.pipe';
import { setupSwagger } from './swagger';

// Shared main.ts for every business service, so all eight behave identically:
// public routes under /api/v1 (reached through the gateway), /internal/* and
// /health outside the prefix, internal key + roles guards, validation,
// error envelope and response envelope.
export async function bootstrapService(
  appModule: Type<unknown>,
  appName: string,
): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(appModule);
  const config = app.get(ConfigService);
  const reflector = app.get(Reflector);

  app.useBodyParser('json', { limit: '1mb' });
  app.use(requestIdMiddleware);

  app.setGlobalPrefix(API_PREFIX, {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'internal/{*path}', method: RequestMethod.ALL },
    ],
  });

  app.useGlobalGuards(
    new InternalKeyGuard(
      reflector,
      config.getOrThrow<string>('INTERNAL_API_KEY'),
    ),
    new RolesGuard(reflector),
  );
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  if (config.get<string>('NODE_ENV') !== 'production') {
    setupSwagger(app, appName);
  }

  app.enableShutdownHooks();

  const port = config.getOrThrow<number>('PORT');
  await app.listen(port);
  Logger.log(`${appName} listening on http://localhost:${port}`, 'Bootstrap');

  return app;
}
