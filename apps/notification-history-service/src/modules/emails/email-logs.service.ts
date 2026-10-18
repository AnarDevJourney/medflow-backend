import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Paginated, paginated, parseSort, skipOf } from '@medflow/common';
import {
  EMAIL_LOG_SORT_FIELDS,
  ListEmailLogsQueryDto,
} from './dto/list-email-logs-query.dto';
import { EmailLog } from './entities/email-log.entity';

// Escapes LIKE wildcards so a search for "a_b" matches literally
const likePattern = (search: string) =>
  `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

// GET /history/emails — what was sent, what is waiting, what failed
@Injectable()
export class EmailLogsService {
  constructor(
    @InjectRepository(EmailLog) private readonly logs: Repository<EmailLog>,
  ) {}

  async list(query: ListEmailLogsQueryDto): Promise<Paginated<EmailLog>> {
    const qb = this.logs.createQueryBuilder('e');
    if (query.status)
      qb.andWhere('e.status = :status', { status: query.status });
    if (query.template) {
      qb.andWhere('e.template = :template', { template: query.template });
    }
    if (query.recipient) {
      qb.andWhere('e.recipientEmail ILIKE :recipient', {
        recipient: likePattern(query.recipient.toLowerCase()),
      });
    }
    if (query.from) qb.andWhere('e.createdAt >= :from', { from: query.from });
    if (query.to) qb.andWhere('e.createdAt <= :to', { to: query.to });

    const sort = parseSort(query.sort, EMAIL_LOG_SORT_FIELDS, {
      createdAt: 'DESC',
    });
    for (const [field, direction] of Object.entries(sort)) {
      qb.addOrderBy(`e.${field}`, direction, 'NULLS LAST');
    }
    qb.addOrderBy('e.id', 'ASC'); // stable pages when timestamps tie

    const [rows, total] = await qb
      .skip(skipOf(query))
      .take(query.limit)
      .getManyAndCount();
    return paginated(rows, total, query);
  }
}
