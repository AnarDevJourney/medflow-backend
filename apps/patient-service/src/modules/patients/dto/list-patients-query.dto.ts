import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '@medflow/common';
import { Gender } from '../entities/patient.entity';

export const PATIENT_SORT_FIELDS = [
  'createdAt',
  'name',
  'mrn',
  'dateOfBirth',
] as const;

// GET /patients?search=leyla&isActive=true&gender=FEMALE&sort=name:asc
// search: fuzzy full name, or exact MRN ("P-000123" / "123"), FIN or phone.
// With a search and no sort, the best matches come first.
export class ListPatientsQueryDto extends PaginationQueryDto {
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
  isActive?: boolean;

  @ApiPropertyOptional({ enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;
}
