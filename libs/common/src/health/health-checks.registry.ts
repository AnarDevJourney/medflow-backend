import { Injectable } from '@nestjs/common';
import type { HealthIndicatorFunction } from '@nestjs/terminus';

// Extra checks for GET /health registered by other libs (e.g. libs/kafka),
// so libs/common does not have to know about them.
@Injectable()
export class HealthChecksRegistry {
  private readonly checks: HealthIndicatorFunction[] = [];

  register(check: HealthIndicatorFunction): void {
    this.checks.push(check);
  }

  all(): HealthIndicatorFunction[] {
    return [...this.checks];
  }
}
