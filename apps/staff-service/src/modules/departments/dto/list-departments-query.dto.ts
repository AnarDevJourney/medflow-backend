import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '@medflow/common';

export const DEPARTMENT_SORT_FIELDS = ['name', 'code', 'createdAt'] as const;

// GET /departments/all?search=card&isActive=false&sort=name:asc&page=1&limit=20
export class ListDepartmentsQueryDto extends PaginationQueryDto {
  // Matches name, code or location
  @ApiPropertyOptional({ example: 'card' })
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
}
