import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '@medflow/common';

export const NOTIFICATION_SORT_FIELDS = ['createdAt'] as const;

// GET /notifications?unread=true&page=1&limit=20 — newest first
export class ListNotificationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'true = only unread' })
  @IsOptional()
  // Implicit conversion would turn the string "false" into true
  @Transform(({ obj, key }: { obj: Record<string, unknown>; key: string }) =>
    obj[key] === 'true' ? true : obj[key] === 'false' ? false : obj[key],
  )
  @IsBoolean()
  unread?: boolean;
}
