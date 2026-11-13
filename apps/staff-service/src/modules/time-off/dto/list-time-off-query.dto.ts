import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsUUID,
  Matches,
} from 'class-validator';
import { PaginationQueryDto } from '@medflow/common';

export const TIME_OFF_SORT_FIELDS = ['createdAt', 'startDate'] as const;
export const TIME_OFF_SCOPES = ['upcoming', 'past'] as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// GET /time-off?userId=&from=&to=&scope=upcoming&sort=startDate:asc
// from / to: periods that touch this range. scope (clinic "today"):
// upcoming = not ended yet (current + future), past = already ended.
export class ListTimeOffQueryDto extends PaginationQueryDto {
  // Without schedules.read only one's own periods; missing = one's own
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ example: '2026-07-01' })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(DAY, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-07-31' })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(DAY, { message: 'to must be YYYY-MM-DD' })
  to?: string;

  @ApiPropertyOptional({ enum: TIME_OFF_SCOPES })
  @IsOptional()
  @IsIn(TIME_OFF_SCOPES)
  scope?: (typeof TIME_OFF_SCOPES)[number];
}
