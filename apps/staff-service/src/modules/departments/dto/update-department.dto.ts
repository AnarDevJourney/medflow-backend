import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PHONE_PATTERN, trim, trimToNull } from './create-department.dto';

const isSent = (_: unknown, value: unknown) => value !== undefined;

// PATCH /departments/:id — code is not here: it never changes. name and
// isActive may be left out but not cleared (ValidateIf rejects null);
// null on the others empties the field.
export class UpdateDepartmentDto {
  @ApiPropertyOptional({ example: 'Cardiology' })
  @ValidateIf(isSent)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(100)
  location?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @Matches(PHONE_PATTERN, { message: 'phone must be a valid phone number' })
  phone?: string | null;

  // The raw value: implicit conversion would turn the string "false" into true
  @ApiPropertyOptional({ description: 'false deactivates the department' })
  @ValidateIf(isSent)
  @Transform(
    ({ obj, key }: { obj: Record<string, unknown>; key: string }) => obj[key],
  )
  @IsBoolean()
  isActive?: boolean;
}
