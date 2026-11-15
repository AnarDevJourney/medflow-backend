import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsUUID,
  Matches,
} from 'class-validator';
import { DAY_PATTERN } from './availability-query.dto';

// GET /appointments/calendar?from=2026-11-16&to=2026-11-22[&departmentId]
// [&doctorId][&includeCancelled=true] — clinic days, both inclusive, ≤ 14
export class CalendarQueryDto {
  @ApiProperty({ example: '2026-11-16' })
  @IsDateString({ strict: true })
  @Matches(DAY_PATTERN, { message: 'from must be YYYY-MM-DD' })
  from: string;

  @ApiProperty({ example: '2026-11-22' })
  @IsDateString({ strict: true })
  @Matches(DAY_PATTERN, { message: 'to must be YYYY-MM-DD' })
  to: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  doctorId?: string;

  // The raw value: implicit conversion would turn "false" into true
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ obj, key }: { obj: Record<string, unknown>; key: string }) => {
    const raw = obj[key];
    if (raw === 'true') return true;
    return raw === 'false' ? false : raw;
  })
  @IsBoolean()
  includeCancelled?: boolean;
}
