import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '@medflow/common';
import { AppointmentStatus } from '../entities/appointment.entity';
import { DAY_PATTERN } from './availability-query.dto';

export const APPOINTMENT_SORT_FIELDS = ['createdAt', 'startsAt'] as const;

// GET /appointments?from=2026-11-16&to=2026-11-22&doctorId=…&status=SCHEDULED
// from / to: clinic calendar days, both inclusive. search: patient name or
// MRN. A doctor sees their own appointments unless allDoctors=true or a
// doctorId is given.
export class ListAppointmentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: '2026-11-16' })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(DAY_PATTERN, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-22' })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(DAY_PATTERN, { message: 'to must be YYYY-MM-DD' })
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  doctorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @ApiPropertyOptional({ enum: AppointmentStatus })
  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;

  @ApiPropertyOptional({ example: 'leyla' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsString()
  @MaxLength(100)
  search?: string;

  // The raw value: implicit conversion would turn "false" into true
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ obj, key }: { obj: Record<string, unknown>; key: string }) => {
    const raw = obj[key];
    if (raw === 'true') return true;
    return raw === 'false' ? false : raw;
  })
  @IsBoolean()
  allDoctors?: boolean;
}
