import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, Worker } from 'bullmq';
import Redis from 'ioredis';
import { Repository } from 'typeorm';
import { EMAIL_QUEUE } from './email.queue';
import { EmailLog, EmailStatus } from './entities/email-log.entity';
import { MailerService } from './mailer.service';
import type { EmailRow } from './mapper/email.mapper';

// Consumer side of the email queue (DOC 6.7, 6.8): render + send one email,
// keep email_logs in step. Runs in this process next to the Kafka
// consumers, but on its own schedule — a slow or dead SMTP server delays
// emails only, never history or notifications.
//
// Per job: row not QUEUED → nothing to do (already sent / given up, e.g. a
// redelivered event) · link expired → FAILED without sending · send →
// SENT, or error saved and BullMQ retries; after the last attempt FAILED.
@Injectable()
export class EmailWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(EmailWorker.name);
  private worker?: Worker;

  constructor(
    private readonly config: ConfigService,
    private readonly mailer: MailerService,
    @InjectRepository(EmailLog) private readonly logs: Repository<EmailLog>,
  ) {}

  onApplicationBootstrap() {
    this.worker = new Worker(
      EMAIL_QUEUE,
      (job: Job<EmailRow>) => this.send(job),
      {
        connection: new Redis(this.config.getOrThrow<string>('REDIS_URL'), {
          maxRetriesPerRequest: null,
        }),
        concurrency: this.config.getOrThrow<number>('EMAIL_CONCURRENCY'),
        // SMTP providers limit messages per second
        limiter: {
          max: this.config.getOrThrow<number>('EMAIL_RATE_LIMIT_PER_SECOND'),
          duration: 1000,
        },
      },
    );
    this.worker.on('error', (error) =>
      this.logger.error(`Email worker: ${error.message}`),
    );
  }

  async onApplicationShutdown() {
    await this.worker?.close(); // lets the emails in progress finish
  }

  private async send(job: Job<EmailRow>): Promise<void> {
    const email = job.data;
    const log = await this.logs.findOneBy({
      eventId: email.eventId,
      template: email.template,
      recipientEmail: email.recipientEmail,
    });
    if (!log) {
      this.logger.warn(`No email_logs row for job ${job.id}, skipped`);
      return;
    }
    if (log.status !== EmailStatus.QUEUED) return;

    if (email.expiresAt && Date.parse(email.expiresAt) <= Date.now()) {
      await this.logs.update(log.id, {
        status: EmailStatus.FAILED,
        error: 'Expired before it could be sent',
      });
      this.logger.warn(
        `${email.template} to ${log.recipientEmail} expired, not sent`,
      );
      return;
    }

    await this.logs.increment({ id: log.id }, 'attempts', 1);
    try {
      await this.mailer.send({
        messageId: log.id,
        to: log.recipientEmail,
        subject: log.subject,
        template: email.template,
        data: email.data,
      });
    } catch (error) {
      const message = (error as Error).message;
      const last = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      await this.logs.update(log.id, {
        error: message,
        status: last ? EmailStatus.FAILED : EmailStatus.QUEUED,
      });
      if (last) {
        this.logger.error(
          `${email.template} to ${log.recipientEmail} failed for good: ${message}`,
        );
      } else {
        this.logger.warn(
          `${email.template} to ${log.recipientEmail} failed (attempt ${job.attemptsMade + 1}), retrying: ${message}`,
        );
      }
      throw error; // BullMQ schedules the next attempt
    }

    await this.logs.update(log.id, {
      status: EmailStatus.SENT,
      sentAt: new Date(),
      error: null,
    });
    this.logger.log(`${email.template} sent to ${log.recipientEmail}`);
  }
}
