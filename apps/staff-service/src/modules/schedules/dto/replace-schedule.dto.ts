import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export const SLOT_MINUTES = [10, 15, 20, 30, 45, 60] as const;

// 'HH:mm', 00:00–23:59
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// One working weekday. Rules that need more than one field (end after
// start, whole slots, one row per day) are checked by the service → 422.
export class ScheduleDayDto {
  @ApiProperty({
    minimum: 1,
    maximum: 7,
    example: 1,
    description: 'ISO: 1 = Monday … 7 = Sunday',
  })
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek: number;

  @ApiProperty({ example: '09:00' })
  @Matches(TIME_PATTERN, { message: 'startTime must be HH:mm' })
  startTime: string;

  @ApiProperty({ example: '17:00' })
  @Matches(TIME_PATTERN, { message: 'endTime must be HH:mm' })
  endTime: string;

  @ApiProperty({ enum: SLOT_MINUTES, example: 30 })
  @IsIn(SLOT_MINUTES)
  slotMinutes: number;
}

// PUT /schedules/:userId — the whole week. A day that is not sent is a day
// off; an empty list = the doctor does not work at all.
export class ReplaceScheduleDto {
  @ApiProperty({ type: [ScheduleDayDto] })
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => ScheduleDayDto)
  days: ScheduleDayDto[];
}
