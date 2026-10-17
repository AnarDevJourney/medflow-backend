import { Controller, Get, Optional } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorFunction,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { DataSource } from 'typeorm';
import { SkipInternalKey } from '../decorators/skip-internal-key.decorator';
import { HealthChecksRegistry } from './health-checks.registry';

// GET /health (outside the api/v1 prefix). Called by the gateway's
// aggregated health check and by Docker healthchecks — hence no internal key.
// Checks only what the app actually has: the database when TypeORM is loaded,
// plus whatever other libs registered (Kafka).
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly registry: HealthChecksRegistry,
    @Optional() private readonly dataSource?: DataSource,
  ) {}

  @Get()
  @SkipInternalKey()
  @HealthCheck()
  check() {
    const checks: HealthIndicatorFunction[] = [];
    if (this.dataSource) {
      checks.push(() => this.db.pingCheck('database').withTimeout(1500));
    }
    return this.health.check([...checks, ...this.registry.all()]);
  }
}
