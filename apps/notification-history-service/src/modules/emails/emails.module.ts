import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmailConsumer } from '../../consumers/email.consumer';
import { EmailLogsController } from './email-logs.controller';
import { EmailLogsService } from './email-logs.service';
import { EmailQueue } from './email.queue';
import { EmailWorker } from './email.worker';
import { EmailLog } from './entities/email-log.entity';
import { MailerService } from './mailer.service';
import { EmailMapper } from './mapper/email.mapper';

@Module({
  imports: [TypeOrmModule.forFeature([EmailLog])],
  controllers: [EmailLogsController],
  providers: [
    EmailMapper,
    EmailConsumer,
    EmailQueue,
    EmailWorker,
    MailerService,
    EmailLogsService,
  ],
})
export class EmailsModule {}
