import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthConfigService } from '../../config/auth-config.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { SessionsService } from './sessions.service';
import { TokenRevocationService } from './token-revocation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([RefreshToken]),
    JwtModule.registerAsync({
      inject: [AuthConfigService],
      useFactory: (config: AuthConfigService) => ({
        secret: config.jwtAccessSecret,
        signOptions: { expiresIn: config.accessTtlSeconds },
      }),
    }),
  ],
  providers: [SessionsService, TokenRevocationService],
  exports: [SessionsService, TokenRevocationService],
})
export class SessionsModule {}
