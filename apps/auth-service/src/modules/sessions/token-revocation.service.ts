import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { AUTH_REDIS_KEYS, REDIS_CLIENT } from '@medflow/common';
import { AuthConfigService } from '../../config/auth-config.service';

// Kills access tokens before they expire by writing keys the gateway checks
// on every request. Written directly (not via Kafka) so the block is instant.
@Injectable()
export class TokenRevocationService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: AuthConfigService,
  ) {}

  // Logout: block this one token for the rest of its lifetime
  async blockToken(jti: string, exp: number): Promise<void> {
    const ttl = exp - Math.floor(Date.now() / 1000);
    if (ttl <= 0) return; // already expired, nothing to block
    await this.redis.set(AUTH_REDIS_KEYS.blockedToken(jti), '1', 'EX', ttl);
  }

  // Deactivation, password reset, refresh reuse: every token issued until now
  // dies. Tokens issued later (a new login) are not affected. Kept for one
  // access-token lifetime — after that every older token has expired anyway.
  async revokeAllTokens(userId: string): Promise<void> {
    await this.redis.set(
      AUTH_REDIS_KEYS.revokedBefore(userId),
      String(Date.now()),
      'EX',
      this.config.accessTtlSeconds,
    );
  }
}
