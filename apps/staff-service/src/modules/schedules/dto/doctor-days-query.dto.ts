import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID, Matches } from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// GET /internal/doctors/days?from=2026-11-16&to=2026-11-22[&departmentId][&doctorId]
// Both days inclusive, at most 31 days.
export class DoctorDaysQueryDto {
  @ApiProperty({ example: '2026-11-16' })
  @IsDateString({ strict: true })
  @Matches(DAY, { message: 'from must be YYYY-MM-DD' })
  from: string;

  @ApiProperty({ example: '2026-11-22' })
  @IsDateString({ strict: true })
  @Matches(DAY, { message: 'to must be YYYY-MM-DD' })
  to: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ description: 'auth user id of one doctor' })
  @IsOptional()
  @IsUUID()
  doctorId?: string;
}
