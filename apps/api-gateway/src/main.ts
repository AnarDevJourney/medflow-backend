import { Logger, RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import type { Request, Response } from 'express';
import {
  API_PREFIX,
  ErrorCode,
  HEADERS,
  HttpExceptionFilter,
  requestIdMiddleware,
  TransformInterceptor,
} from '@medflow/common';
import { AppModule } from './app.module';
import { AuthMiddleware } from './auth/auth.middleware';
import { GatewayConfigService } from './config/gateway-config.service';
import { ProxyService } from './proxy/proxy.service';
import { RateLimitMiddleware } from './rate-limit/rate-limit.middleware';

function notFoundFallback(req: Request, res: Response) {
  res.status(404).json({
    success: false,
    error: {
      statusCode: 404,
      code: ErrorCode.NOT_FOUND,
      message: `Cannot ${req.method} ${req.path}`,
      path: req.originalUrl,
      requestId: req.headers[HEADERS.REQUEST_ID] ?? null,
      details: null,
    },
  });
}

async function bootstrap() {
  // No body parsing: proxied bodies (incl. file uploads) stream straight to services
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  const config = app.get(GatewayConfigService);
  const proxy = app.get(ProxyService);
  const rateLimit = app.get(RateLimitMiddleware);
  const auth = app.get(AuthMiddleware);

  app.use(helmet());
  app.enableCors({ origin: config.frontendUrl, credentials: true });
  app.use(requestIdMiddleware);

  // DOC 1.3 steps 3–6: rate limit → JWT + block-list → proxy (sets the
  // trusted x-user-* headers). All run before Nest's router; anything the
  // proxy doesn't own falls through to the gateway's own routes
  // (/api/v1/health, /docs) or a 404.
  app.use(rateLimit.middleware);
  app.use(auth.middleware);
  app.use(proxy.middleware);

  app.setGlobalPrefix(API_PREFIX, {
    exclude: [{ path: 'docs', method: RequestMethod.GET }],
  });
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());
  app.enableShutdownHooks();

  // Nest's own 404 handler only covers /api/v1 — answer everything else
  // in the same JSON envelope instead of Express' HTML page
  await app.init();
  app.use(notFoundFallback);

  await app.listen(config.port);
  app.getHttpServer().on('upgrade', proxy.upgrade);

  Logger.log(
    `api-gateway listening on http://localhost:${config.port}/${API_PREFIX}`,
    'Bootstrap',
  );
}

void bootstrap();
