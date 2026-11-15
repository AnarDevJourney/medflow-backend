import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID, Matches } from 'class-validator';

export const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// GET /appointments/availability?doctorId=…&date=2026-11-16[&patientId=…]
// patientId (optional): also mark the slots where this patient is already
// booked with someone else.
export class AvailabilityQueryDto {
  @ApiProperty()
  @IsUUID()
  doctorId: string;

  @ApiProperty({ example: '2026-11-16' })
  @IsDateString({ strict: true })
  @Matches(DAY_PATTERN, { message: 'date must be YYYY-MM-DD' })
  date: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  patientId?: string;
}
