import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { DiagnosisType } from '../entities/diagnosis.entity';

const trimToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

// POST /encounters/:id/diagnoses. Without a type the first diagnosis of
// the visit becomes PRIMARY, later ones SECONDARY. PRIMARY on a visit that
// has one moves the old one to SECONDARY. Without a code = an uncoded
// diagnosis: the description is required and it is always SECONDARY.
export class AddDiagnosisDto {
  @ApiPropertyOptional({ example: 'I10' })
  @IsOptional()
  @Transform(upper)
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  icd10Code?: string;

  @ApiPropertyOptional({ enum: DiagnosisType })
  @IsOptional()
  @IsEnum(DiagnosisType)
  type?: DiagnosisType;

  @ApiPropertyOptional({ description: 'Defaults to the ICD-10 title' })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(255)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

// PATCH /encounters/:id/diagnoses/:dxId — make it primary / secondary,
// refine the wording, notes (null clears)
export class UpdateDiagnosisDto {
  @ApiPropertyOptional({ enum: DiagnosisType })
  @IsOptional()
  @IsEnum(DiagnosisType)
  type?: DiagnosisType;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  description?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}
