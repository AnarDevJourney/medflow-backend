import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { trimToNull } from '../../departments/dto/create-department.dto';
import { TimeOffType } from '../entities/time-off.entity';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// POST /time-off. Order of the dates, length and overlap → 422 / 409.
export class CreateTimeOffDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  userId: string;

  @ApiProperty({ enum: TimeOffType })
  @IsEnum(TimeOffType)
  type: TimeOffType;

  @ApiProperty({ example: '2026-07-15' })
  @IsDateString({ strict: true })
  @Matches(DAY, { message: 'startDate must be YYYY-MM-DD' })
  startDate: string;

  // Inclusive: start = end is one day
  @ApiProperty({ example: '2026-07-29' })
  @IsDateString({ strict: true })
  @Matches(DAY, { message: 'endDate must be YYYY-MM-DD' })
  endDate: string;

  @ApiPropertyOptional({ nullable: true, example: 'Annual leave' })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(255)
  reason?: string | null;
}
