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

  serviceUrl(service: ServiceRoute): string {
    return this.config.getOrThrow<string>(service.urlEnv).replace(/\/+$/, '');
  }
}
