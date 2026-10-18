import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

// "15m" → 900. Format is guaranteed by the Joi schema.
function toSeconds(duration: string): number {
  return Number(duration.slice(0, -1)) * UNIT_SECONDS[duration.slice(-1)];
}

@Injectable()
export class AuthConfigService {
  constructor(private readonly config: ConfigService) {}

  get isProduction(): boolean {
    return this.config.get<string>('NODE_ENV') === 'production';
  }

  get frontendUrl(): string {
    return this.config.getOrThrow<string>('FRONTEND_URL').replace(/\/+$/, '');
  }

  get jwtAccessSecret(): string {
    return this.config.getOrThrow<string>('JWT_ACCESS_SECRET');
  }

  get accessTtlSeconds(): number {
    return toSeconds(this.config.get<string>('JWT_ACCESS_TTL', '15m'));
  }

  get refreshTtlSeconds(): number {
    return toSeconds(this.config.get<string>('JWT_REFRESH_TTL', '7d'));
  }

  get cookieSecure(): boolean {
    const value = this.config.get<boolean | string>('COOKIE_SECURE');
    if (value === undefined) return this.isProduction;
    return value === true || value === 'true';
  }

  get seedAdmin(): { email: string; password: string } | null {
    const email = this.config.get<string>('SEED_ADMIN_EMAIL');
    const password = this.config.get<string>('SEED_ADMIN_PASSWORD');
    return email && password ? { email: email.toLowerCase(), password } : null;
  }
}
