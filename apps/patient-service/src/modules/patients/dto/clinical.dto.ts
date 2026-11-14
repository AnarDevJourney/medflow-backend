import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  AllergyCategory,
  AllergySeverity,
} from '../entities/patient-allergy.entity';
import { ConditionStatus } from '../entities/patient-condition.entity';
import { DAY_PATTERN } from './create-patient.dto';

// E11, I10, J45.909
export const ICD10_PATTERN = /^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const trimToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;
const upperToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() || null : value;

// POST /patients/:id/allergies
export class CreateAllergyDto {
  @ApiProperty({ example: 'Penicillin' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  allergen: string;

  @ApiProperty({ enum: AllergyCategory })
  @IsEnum(AllergyCategory)
  category: AllergyCategory;

  @ApiProperty({ enum: AllergySeverity })
  @IsEnum(AllergySeverity)
  severity: AllergySeverity;

  @ApiPropertyOptional({ example: 'Skin rash', nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(255)
  reaction?: string | null;
}

// PATCH /patients/:id/allergies/:allergyId — every field, like a condition.
// The allergen cannot be cleared (checked in the service).
export class UpdateAllergyDto extends PartialType(CreateAllergyDto) {}

// POST /patients/:id/conditions
export class CreateConditionDto {
  @ApiProperty({ example: 'Type 2 diabetes mellitus' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional({ example: 'E11', nullable: true })
  @IsOptional()
  @Transform(upperToNull)
  @IsString()
  @Matches(ICD10_PATTERN, {
    message: 'icd10Code must look like E11 or J45.909',
  })
  icd10Code?: string | null;

  // Not in the future (checked in the service)
  @ApiPropertyOptional({ example: '2019-03-01', nullable: true })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(DAY_PATTERN, { message: 'diagnosedOn must be YYYY-MM-DD' })
  diagnosedOn?: string | null;

  @ApiPropertyOptional({
    enum: ConditionStatus,
    default: ConditionStatus.ACTIVE,
  })
  @IsOptional()
  @IsEnum(ConditionStatus)
  status?: ConditionStatus;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

// PATCH /patients/:id/conditions/:conditionId — status, notes, and fixing
// the name / code / date. The name cannot be cleared (checked in the service).
export class UpdateConditionDto extends PartialType(CreateConditionDto) {}
