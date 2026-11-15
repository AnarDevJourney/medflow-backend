import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { AppointmentType } from '../entities/appointment.entity';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const trimToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

// PATCH /appointments/:id/reschedule — a new slot, optionally with another
// doctor. Same rules as booking.
export class RescheduleAppointmentDto {
  @ApiProperty({ example: '2026-11-17T06:00:00Z' })
  @IsDateString({ strict: true, strictSeparator: true })
  startsAt: string;

  @ApiPropertyOptional({ description: 'Another doctor (default: the same)' })
  @IsOptional()
  @IsUUID()
  doctorId?: string;
}

// PATCH /appointments/:id/cancel
export class CancelAppointmentDto {
  @ApiProperty({ example: 'The patient called to cancel' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

// PATCH /appointments/:id — the visit details; time / doctor go through
// reschedule, the patient never changes (cancel + book again)
export class UpdateAppointmentDto {
  @ApiPropertyOptional({ enum: AppointmentType })
  @IsOptional()
  @IsEnum(AppointmentType)
  type?: AppointmentType;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(500)
  reason?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

// GET /appointments/today
export class TodayQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  doctorId?: string;
}
