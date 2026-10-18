import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { Paginated, paginated, parseSort, skipOf } from '@medflow/common';
import {
  HISTORY_SORT_FIELDS,
  HistoryRangeQueryDto,
  ListHistoryQueryDto,
} from './dto/history-query.dto';
import { ActionHistory } from './entities/action-history.entity';
import { HistoryResponse, toHistoryResponse } from './history.response';

type HistoryQuery = SelectQueryBuilder<ActionHistory>;

// Read side of the action history (DOC 8.9). Rows are written only by
// ActionHistoryConsumer and never change.
@Injectable()
export class HistoryService {
  constructor(
    @InjectRepository(ActionHistory)
    private readonly history: Repository<ActionHistory>,
  ) {}

  list(query: ListHistoryQueryDto): Promise<Paginated<HistoryResponse>> {
    return this.page(query, (qb) => {
      if (query.eventType) {
        qb.andWhere('h.eventType = :eventType', { eventType: query.eventType });
      }
      if (query.actorId) {
        qb.andWhere('h.actorId = :actorId', { actorId: query.actorId });
      }
      if (query.entityType) {
        qb.andWhere('h.entityType = :entityType', {
          entityType: query.entityType,
        });
      }
    });
  }

  // One appointment / invoice / lab order / user
  forEntity(
    entityType: string,
    entityId: string,
    query: HistoryRangeQueryDto,
  ): Promise<Paginated<HistoryResponse>> {
    return this.page(query, (qb) =>
      qb
        .andWhere('h.entityType = :entityType', { entityType })
        .andWhere('h.entityId = :entityId', { entityId }),
    );
  }

  // Patient timeline across all services
  forPatient(
    patientId: string,
    query: HistoryRangeQueryDto,
  ): Promise<Paginated<HistoryResponse>> {
    return this.page(query, (qb) =>
      qb.andWhere('h.patientId = :patientId', { patientId }),
    );
  }

  // What one staff member did
  forActor(
    userId: string,
    query: HistoryRangeQueryDto,
  ): Promise<Paginated<HistoryResponse>> {
    return this.page(query, (qb) =>
      qb.andWhere('h.actorId = :userId', { userId }),
    );
  }

  private async page(
    query: HistoryRangeQueryDto,
    filter: (qb: HistoryQuery) => void,
  ): Promise<Paginated<HistoryResponse>> {
    const qb = this.history.createQueryBuilder('h');
    filter(qb);
    if (query.from) qb.andWhere('h.occurredAt >= :from', { from: query.from });
    if (query.to) qb.andWhere('h.occurredAt <= :to', { to: query.to });

    const sort = parseSort(query.sort, HISTORY_SORT_FIELDS, {
      occurredAt: 'DESC',
    });
    for (const [field, direction] of Object.entries(sort)) {
      qb.addOrderBy(`h.${field}`, direction);
    }
    qb.addOrderBy('h.id', 'ASC'); // stable pages when timestamps tie

    const [rows, total] = await qb
      .skip(skipOf(query))
      .take(query.limit)
      .getManyAndCount();
    return paginated(rows.map(toHistoryResponse), total, query);
  }
}
