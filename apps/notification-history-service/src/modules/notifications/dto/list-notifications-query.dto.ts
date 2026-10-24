import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsISO8601, IsOptional, Matches } from 'class-validator';
import { PaginationQueryDto } from '@medflow/common';

export const NOTIFICATION_SORT_FIELDS = ['createdAt'] as const;

// Implicit conversion would turn the string "false" into true
const queryBoolean = ({
  obj,
  key,
}: {
  obj: Record<string, unknown>;
  key: string;
}) => (obj[key] === 'true' ? true : obj[key] === 'false' ? false : obj[key]);

// GET /notifications?unread=true&urgent=true&type=SESSION_REVOKED
//   &from=2026-10-01&to=2026-10-25T23:59:59Z&page=1&limit=20 — newest first
export class ListNotificationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'true = only unread, false = only read' })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  unread?: boolean;

  @ApiPropertyOptional({
    description: 'true = only urgent, false = only normal',
  })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  urgent?: boolean;

  @ApiPropertyOptional({ example: 'SESSION_REVOKED' })
  @IsOptional()
  @Matches(/^[A-Z][A-Z_]{0,59}$/, {
    message: 'type must look like "LAB_RESULT_READY"',
  })
  type?: string;

  @ApiPropertyOptional({ example: '2026-10-01T00:00:00Z' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-25T23:59:59Z' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
