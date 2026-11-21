import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trimToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

const NOTE_MAX = 5000;

// POST /encounters — "Start visit" on a checked-in appointment
export class StartEncounterDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  appointmentId: string;
}

// PATCH /encounters/:id — the doctor's notes, saved as they type. Every
// field optional; null (or blank) clears it.
export class UpdateEncounterDto {
  @ApiPropertyOptional({ example: 'Chest pain for 3 days', nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(NOTE_MAX)
  chiefComplaint?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(NOTE_MAX)
  examinationNotes?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(NOTE_MAX)
  treatmentPlan?: string | null;

  @ApiPropertyOptional({ minimum: 1, maximum: 365, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  followUpInDays?: number | null;
}
