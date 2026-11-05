import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export const PHONE_PATTERN = /^\+?[0-9 ()-]{5,19}$/;

export const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// An empty optional field is stored as NULL, not as ''
export const trimToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

const normalizeCode = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class CreateDepartmentDto {
  // Free text, stored in upper case (DATABASE.md: CHECK code = upper(code))
  @ApiProperty({ example: 'CARD', maxLength: 10 })
  @Transform(normalizeCode)
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  code: string;

  @ApiProperty({ example: 'Cardiology' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiPropertyOptional({ example: 'Building A, Floor 2', nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(100)
  location?: string | null;

  @ApiPropertyOptional({ example: '+994 12 555 10 20', nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @Matches(PHONE_PATTERN, { message: 'phone must be a valid phone number' })
  phone?: string | null;
}
