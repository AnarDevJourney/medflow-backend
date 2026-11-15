import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, Matches } from 'class-validator';
import { DAY_PATTERN } from './availability-query.dto';

// GET /appointments/stats/overview?from=2026-10-17&to=2026-11-15 — clinic
// days, both inclusive; default the last 30 days up to today
export class StatsQueryDto {
  @ApiPropertyOptional({ example: '2026-10-17' })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(DAY_PATTERN, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-15' })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(DAY_PATTERN, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}
