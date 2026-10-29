import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { createConfigModule, RedisModule } from '@medflow/common';
import { AuthMiddleware } from './auth/auth.middleware';
import { RolePermissionsService } from './auth/role-permissions.service';
import { envValidationSchema } from './config/env.validation';
import { GatewayConfigService } from './config/gateway-config.service';
import { DocsController } from './docs/docs.controller';
import { HealthController } from './health/health.controller';
import { HealthService } from './health/health.service';
import { ProxyService } from './proxy/proxy.service';
import { RateLimitMiddleware } from './rate-limit/rate-limit.middleware';

@Module({
  imports: [
    createConfigModule('api-gateway', envValidationSchema),
    RedisModule,
    // Verify-only: the gateway never signs tokens
    JwtModule.registerAsync({
      extraProviders: [GatewayConfigService],
      inject: [GatewayConfigService],
      useFactory: (config: GatewayConfigService) => ({
        secret: config.jwtAccessSecret,
      }),
    }),
  ],
  controllers: [HealthController, DocsController],
  providers: [
    GatewayConfigService,
    ProxyService,
    HealthService,
    AuthMiddleware,
    RolePermissionsService,
    RateLimitMiddleware,
  ],
})
export class AppModule {}
