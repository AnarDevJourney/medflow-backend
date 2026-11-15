import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { AppointmentType } from '../entities/appointment.entity';

// An empty optional text is stored as NULL, not as ''
const trimToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

// POST /appointments (DOC 6.2). The end, the department and every name
// come from the doctor's schedule and the patient record, never the client.
export class CreateAppointmentDto {
  @ApiProperty()
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: 'auth user id of the doctor' })
  @IsUUID()
  doctorId: string;

  @ApiProperty({ example: '2026-11-16T05:30:00Z', description: 'Slot start' })
  @IsDateString({ strict: true, strictSeparator: true })
  startsAt: string;

  @ApiPropertyOptional({
    enum: AppointmentType,
    default: AppointmentType.CONSULTATION,
  })
  @IsOptional()
  @IsEnum(AppointmentType)
  type?: AppointmentType;

  @ApiPropertyOptional({ example: 'Chest pain for two days' })
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
