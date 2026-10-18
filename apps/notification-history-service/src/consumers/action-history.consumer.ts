import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { Topic, Topics } from '@medflow/contracts';
import type { EventEnvelope } from '@medflow/contracts';
import { BaseBatchConsumer } from '@medflow/kafka';
import { ActionHistory } from '../modules/history/entities/action-history.entity';
import {
  HistoryMapper,
  NewActionHistory,
} from '../modules/history/mapper/history.mapper';

// Every domain topic (not the dead letters)
const DOMAIN_TOPICS: readonly Topic[] = Object.values(Topics).filter(
  (topic) => topic !== Topics.DEAD_LETTER,
);

// 13 parameters per row; Postgres allows 65 535 per statement, and 1 MB of
// small events can be a few thousand rows
const ROWS_PER_INSERT = 1000;

// Every event of the system → one action_history row (DOC 6.7). The volume
// is the sum of all services, so events are written in batches: everything
// one fetch brought (≤ HISTORY_BATCH_MAX_BYTES) for a partition is inserted
// in one transaction. Own consumer group, so the in-app notifications
// (same topics, phase 4.2) keep separate offsets and never block history.
@Injectable()
export class ActionHistoryConsumer extends BaseBatchConsumer<NewActionHistory> {
  protected readonly topics = DOMAIN_TOPICS;
  protected readonly groupSuffix = 'action-history';
  protected readonly maxBytes: number;

  constructor(
    private readonly mapper: HistoryMapper,
    config: ConfigService,
  ) {
    super();
    this.maxBytes = config.getOrThrow<number>('HISTORY_BATCH_MAX_BYTES');
  }

  protected toRow(event: EventEnvelope): NewActionHistory | null {
    return this.mapper.map(event);
  }

  // INSERT … ON CONFLICT (event_id) DO NOTHING: a redelivered event (also
  // twice inside one batch) is silently skipped
  protected async saveRows(
    rows: NewActionHistory[],
    em: EntityManager,
  ): Promise<number> {
    let inserted = 0;
    for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
      const result = await em
        .createQueryBuilder()
        .insert()
        .into(ActionHistory)
        .values(
          // metadata is plain JSON; TypeORM's deep-partial type cannot see that
          rows.slice(
            i,
            i + ROWS_PER_INSERT,
          ) as QueryDeepPartialEntity<ActionHistory>[],
        )
        .orIgnore()
        .returning('id')
        .updateEntity(false)
        .execute();
      inserted += (result.raw as unknown[]).length;
    }
    return inserted;
  }
}
