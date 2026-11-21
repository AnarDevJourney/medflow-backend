import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '@medflow/common';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const trimToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

// GET /icd10?search= — the doctor's autocomplete
export class SearchIcd10Dto {
  @ApiPropertyOptional({ example: 'hyper' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;
}

export const CATALOG_STATUSES = ['active', 'inactive', 'all'] as const;

// GET /icd10/catalog — the admin's list, by code
export class Icd10CatalogQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 22 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(22)
  chapterNo?: number;

  @ApiPropertyOptional({ enum: CATALOG_STATUSES, default: 'all' })
  @IsOptional()
  @IsIn(CATALOG_STATUSES)
  status?: (typeof CATALOG_STATUSES)[number];

  // only entries with an Azerbaijani or Russian name
  @ApiPropertyOptional()
  @IsOptional()
  // the raw query value: implicit conversion would turn "false" into true
  @Transform(
    ({ obj }: { obj: Record<string, unknown> }) =>
      obj.named === true || obj.named === 'true',
  )
  @IsBoolean()
  named?: boolean;

  // machine translations an admin has not checked yet
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(
    ({ obj }: { obj: Record<string, unknown> }) =>
      obj.unverified === true || obj.unverified === 'true',
  )
  @IsBoolean()
  unverified?: boolean;
}

// PATCH /icd10/:code — the code and its official title never change
export class UpdateIcd10Dto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(255)
  titleAz?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(255)
  titleRu?: string | null;

  // "checked" marks for machine translations (set automatically when an
  // admin writes the name)
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  titleAzVerified?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  titleRuVerified?: boolean;

  @ApiPropertyOptional({ type: [String], example: ['təzyiq'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  synonyms?: string[];
}
