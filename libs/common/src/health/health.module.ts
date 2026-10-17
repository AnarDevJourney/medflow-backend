import { Global, Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthChecksRegistry } from './health-checks.registry';
import { HealthController } from './health.controller';

// Global so libs (KafkaModule) can register their checks in the registry
@Global()
@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [HealthChecksRegistry],
  exports: [HealthChecksRegistry],
})
export class HealthModule {}
