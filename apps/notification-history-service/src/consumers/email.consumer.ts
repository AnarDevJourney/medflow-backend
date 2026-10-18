import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';
import { DOMAIN_TOPICS } from '@medflow/contracts';
import type { EventEnvelope } from '@medflow/contracts';
import { BaseBatchConsumer } from '@medflow/kafka';
import { EmailQueue } from '../modules/emails/email.queue';
import { EmailLog } from '../modules/emails/entities/email-log.entity';
import { EmailMapper, EmailRow } from '../modules/emails/mapper/email.mapper';

// 4 parameters per row; Postgres allows 65 535 per statement
const ROWS_PER_INSERT = 1000;

// Events → emails (DOC 5.6, 6.7), in two steps:
// 1. here, like history and notifications: everything one fetch brought
//    (≤ EMAIL_BATCH_MAX_BYTES) for a partition → email_logs rows (QUEUED) in
//    one transaction
// 2. after the commit, before the offset commit: one BullMQ job per email;
//    EmailWorker sends them at its own pace with per-email retries
//
// Every stored row is enqueued, duplicates too: if the process died between
// the commit and the enqueue, the redelivered batch enqueues the jobs then
// (same jobId → no double job; the worker skips rows that are not QUEUED).
// Redis down → afterCommit throws → the batch is redelivered later.
@Injectable()
export class EmailConsumer extends BaseBatchConsumer<EmailRow> {
  protected readonly topics = DOMAIN_TOPICS;
  protected readonly groupSuffix = 'emails';
  protected readonly maxBytes: number;

  constructor(
    private readonly mapper: EmailMapper,
    private readonly queue: EmailQueue,
    config: ConfigService,
  ) {
    super();
    this.maxBytes = config.getOrThrow<number>('EMAIL_BATCH_MAX_BYTES');
  }

  protected toRows(event: EventEnvelope): EmailRow[] {
    return this.mapper.map(event);
  }

  // INSERT … ON CONFLICT (event_id, template, recipient_email) DO NOTHING
  protected async saveRows(
    rows: EmailRow[],
    em: EntityManager,
  ): Promise<unknown[]> {
    const inserted: unknown[] = [];
    for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
      const result = await em
        .createQueryBuilder()
        .insert()
        .into(EmailLog)
        .values(
          rows.slice(i, i + ROWS_PER_INSERT).map((row) => ({
            eventId: row.eventId,
            recipientEmail: row.recipientEmail,
            template: row.template,
            subject: row.subject,
          })),
        )
        .orIgnore()
        .returning('id')
        .updateEntity(false)
        .execute();
      inserted.push(...(result.raw as unknown[]));
    }
    return inserted;
  }

  protected afterCommit(
    _saved: unknown[],
    _events: EventEnvelope[],
    rows: EmailRow[],
  ): Promise<void> {
    return this.queue.enqueue(rows);
  }
}
