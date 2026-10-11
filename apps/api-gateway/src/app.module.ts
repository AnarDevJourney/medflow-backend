import { Module } from '@nestjs/common';
import { createConfigModule, RedisModule } from '@medflow/common';
import { envValidationSchema } from './config/env.validation';
import { GatewayConfigService } from './config/gateway-config.service';
import { DocsController } from './docs/docs.controller';
import { HealthController } from './health/health.controller';
import { HealthService } from './health/health.service';
import { ProxyService } from './proxy/proxy.service';

@Module({
  imports: [
    createConfigModule('api-gateway', envValidationSchema),
    RedisModule,
  ],
  controllers: [HealthController, DocsController],
  providers: [GatewayConfigService, ProxyService, HealthService],
})
export class AppModule {}
