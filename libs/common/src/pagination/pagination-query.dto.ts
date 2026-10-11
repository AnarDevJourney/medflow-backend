import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

// ?page=1&limit=20&sort=createdAt:desc
export class PaginationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({ example: 'createdAt:desc' })
  @IsOptional()
  @Matches(/^[a-zA-Z]+:(asc|desc)$/, {
    message: 'sort must look like "field:asc" or "field:desc"',
  })
  sort?: string;
}
