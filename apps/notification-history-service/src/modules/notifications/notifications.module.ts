import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsConsumer } from '../../consumers/notifications.consumer';
import { Notification } from './entities/notification.entity';
import { NotificationMapper } from './mapper/notification.mapper';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification]),
    // Verifies the access token of the Socket.io handshake (only signing
    // service besides the gateway that knows the secret — DOC 6.7)
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      }),
    }),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsGateway,
    NotificationMapper,
    NotificationsConsumer,
  ],
})
export class NotificationsModule {}
