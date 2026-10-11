import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';

// GET /api/v1/health — public, 503 with per-component details when anything is down
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  check() {
    return this.healthService.check();
  }
}
