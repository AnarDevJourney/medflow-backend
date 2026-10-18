import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import type { EmailRow } from './mapper/email.mapper';

export const EMAIL_QUEUE = 'email';
export const SEND_JOB = 'send';

// DOC 6.7: 3 attempts, exponential backoff (5 s, 10 s)
export const SEND_ATTEMPTS = 3;
const BACKOFF_MS = 5000;

// Producer side of the BullMQ email queue (DOC 6.8). One job per email_logs
// row; the job carries what is needed to render it (incl. links), so a
// finished job is removed right away and a failed one after 7 days.
@Injectable()
export class EmailQueue implements OnApplicationShutdown {
  private readonly queue: Queue;

  constructor(config: ConfigService) {
    this.queue = new Queue(EMAIL_QUEUE, {
      // BullMQ needs maxRetriesPerRequest: null on its connections
      connection: new Redis(config.getOrThrow<string>('REDIS_URL'), {
        maxRetriesPerRequest: null,
      }),
    });
  }

  // jobId is derived from the unique key of email_logs, so adding the same
  // email again (redelivered event) while its job exists is a no-op
  async enqueue(rows: EmailRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.queue.addBulk(
      rows.map((row) => ({
        name: SEND_JOB,
        data: row,
        opts: {
          jobId: emailJobId(row),
          attempts: SEND_ATTEMPTS,
          backoff: { type: 'exponential', delay: BACKOFF_MS },
          removeOnComplete: true,
          removeOnFail: { age: 7 * 24 * 60 * 60 },
        },
      })),
    );
  }

  async onApplicationShutdown() {
    await this.queue.close();
  }
}

// BullMQ ids must not contain ':' — hash the (event, template, recipient) key
function emailJobId(row: EmailRow): string {
  return createHash('sha256')
    .update(`${row.eventId}|${row.template}|${row.recipientEmail}`)
    .digest('hex');
}
