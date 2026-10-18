import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsUUID, Matches } from 'class-validator';
import { PaginationQueryDto } from '@medflow/common';

// 'USER', 'APPOINTMENT', 'LAB_ORDER' (action_history.entity_type is varchar(30))
export const ENTITY_TYPE = /^[A-Z][A-Z_]{0,29}$/;

export const HISTORY_SORT_FIELDS = ['occurredAt'] as const;

// Time window shared by every history list; newest first by default
// ?from=2026-10-01&to=2026-10-18T23:59:59Z&page=1&limit=20&sort=occurredAt:asc
export class HistoryRangeQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: '2026-10-01T00:00:00Z' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-18T23:59:59Z' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}

// GET /history — global audit feed (DOC 8.9)
export class ListHistoryQueryDto extends HistoryRangeQueryDto {
  @ApiPropertyOptional({ example: 'user.invited' })
  @IsOptional()
  @Matches(/^[a-z_]+(\.[a-z_]+)+$/, {
    message: 'eventType must look like "appointment.cancelled"',
  })
  eventType?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiPropertyOptional({ example: 'APPOINTMENT' })
  @IsOptional()
  @Matches(ENTITY_TYPE, { message: 'entityType must look like "LAB_ORDER"' })
  entityType?: string;
}
