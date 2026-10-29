import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { HEADERS, permissionsCacheKey, REDIS_CLIENT } from '@medflow/common';
import { GatewayConfigService } from '../config/gateway-config.service';
import { SERVICES } from '../proxy/service-registry';

const CONFIGURATIONS = SERVICES.find(
  (s) => s.name === 'configurations-service',
)!;

// The role's permissions for x-user-permissions — comma-separated codes, as
// configurations-service keeps them in Redis. Normally one GET; only when
// the key is missing (Redis flushed) configurations-service is asked, which
// reads its database and fills the key again.
@Injectable()
export class RolePermissionsService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: GatewayConfigService,
  ) {}

  // Throws when neither Redis nor configurations-service can answer
  async forRole(role: string): Promise<string> {
    const cached = await this.redis.get(permissionsCacheKey(role));
    if (cached !== null) return cached;
    return this.fetchFromService(role);
  }

  private async fetchFromService(role: string): Promise<string> {
    const url = `${this.config.serviceUrl(CONFIGURATIONS)}/internal/permissions/roles/${encodeURIComponent(role)}`;
    const res = await fetch(url, {
      headers: { [HEADERS.INTERNAL_KEY]: this.config.internalApiKey },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      throw new Error(`configurations-service answered ${res.status}`);
    }
    const body = (await res.json()) as { data: { permissions: string[] } };
    return body.data.permissions.join(',');
  }
}
