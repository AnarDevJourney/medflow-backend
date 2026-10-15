import { Global, Module } from '@nestjs/common';
import { AuthConfigService } from './auth-config.service';

@Global()
@Module({
  providers: [AuthConfigService],
  exports: [AuthConfigService],
})
export class AuthConfigModule {}
