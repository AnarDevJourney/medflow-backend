import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { AppException, ErrorCode, REDIS_CLIENT } from '@medflow/common';
import { GatewayConfigService } from '../config/gateway-config.service';
import { SERVICES, ServiceRoute } from '../proxy/service-registry';

const CHECK_TIMEOUT_MS = 3000;

export interface ComponentHealth {
  status: 'up' | 'down';
  latencyMs?: number;
  error?: string;
}

export interface SystemHealth {
  status: 'ok' | 'error';
  checks: Record<string, ComponentHealth>;
}

// Aggregates Redis + every service's /health into one answer for Docker
// and the admin "service health" widget.
@Injectable()
export class HealthService {
  constructor(
    private readonly config: GatewayConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async check(): Promise<SystemHealth> {
    const [redis, ...services] = await Promise.all([
      this.checkRedis(),
      ...SERVICES.map((s) => this.checkService(s)),
    ]);

    const checks: Record<string, ComponentHealth> = { redis };
    SERVICES.forEach((s, i) => (checks[s.name] = services[i]));

    const result: SystemHealth = {
      status: Object.values(checks).every((c) => c.status === 'up')
        ? 'ok'
        : 'error',
      checks,
    };

    if (result.status !== 'ok') {
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.SERVICE_UNAVAILABLE,
        'One or more components are down',
        result,
      );
    }
    return result;
  }

  private async checkService(service: ServiceRoute): Promise<ComponentHealth> {
    const started = performance.now();
    try {
      const res = await fetch(`${this.config.serviceUrl(service)}/health`, {
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
      const latencyMs = Math.round(performance.now() - started);
      return res.ok
        ? { status: 'up', latencyMs }
        : { status: 'down', latencyMs, error: `HTTP ${res.status}` };
    } catch (err) {
      return { status: 'down', error: describe(err) };
    }
  }

  private async checkRedis(): Promise<ComponentHealth> {
    const started = performance.now();
    try {
      await Promise.race([
        this.redis.ping(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS),
        ),
      ]);
      return {
        status: 'up',
        latencyMs: Math.round(performance.now() - started),
      };
    } catch (err) {
      return { status: 'down', error: describe(err) };
    }
  }
}

// fetch() hides the real reason (ECONNREFUSED…) in err.cause
function describe(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause as { code?: string } | undefined;
  return cause?.code ?? err.message;
}
