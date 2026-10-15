import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ServiceRoute } from '../proxy/service-registry';

@Injectable()
export class GatewayConfigService {
  constructor(private readonly config: ConfigService) {}

  get port(): number {
    return this.config.getOrThrow<number>('PORT');
  }

  get isProduction(): boolean {
    return this.config.get<string>('NODE_ENV') === 'production';
  }

  get frontendUrl(): string {
    return this.config.getOrThrow<string>('FRONTEND_URL');
  }

  get internalApiKey(): string {
    return this.config.getOrThrow<string>('INTERNAL_API_KEY');
  }

  get jwtAccessSecret(): string {
    return this.config.getOrThrow<string>('JWT_ACCESS_SECRET');
  }

  get rateLimitDefault(): number {
    return Number(this.config.get('RATE_LIMIT_DEFAULT', 100));
  }

  get rateLimitStrict(): number {
    return Number(this.config.get('RATE_LIMIT_STRICT', 10));
  }

  serviceUrl(service: ServiceRoute): string {
    return this.config.getOrThrow<string>(service.urlEnv).replace(/\/+$/, '');
  }
}
