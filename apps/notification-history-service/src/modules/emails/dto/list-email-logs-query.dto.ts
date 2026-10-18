import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '@medflow/common';
import { EmailStatus } from '../entities/email-log.entity';

export const EMAIL_LOG_SORT_FIELDS = ['createdAt', 'sentAt'] as const;

// GET /history/emails?status=FAILED&template=staff-invite&recipient=aysel&from=…
export class ListEmailLogsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: EmailStatus })
  @IsOptional()
  @IsEnum(EmailStatus)
  status?: EmailStatus;

  @ApiPropertyOptional({ example: 'staff-invite' })
  @IsOptional()
  @Matches(/^[a-z][a-z-]{0,59}$/, {
    message: 'template must look like "staff-invite"',
  })
  template?: string;

  // Part of the recipient address
  @ApiPropertyOptional({ example: 'aysel' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsString()
  @MaxLength(255)
  recipient?: string;

  @ApiPropertyOptional({ example: '2026-10-01T00:00:00Z' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-19T23:59:59Z' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
