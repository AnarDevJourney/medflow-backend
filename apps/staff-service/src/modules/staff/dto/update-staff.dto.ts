import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  PHONE_PATTERN,
  trimToNull,
} from '../../departments/dto/create-department.dto';

// PATCH /staff/me — what a person may change on their own profile.
// null (or an empty string) clears a field.
export class UpdateOwnStaffDto {
  @ApiPropertyOptional({ nullable: true, example: '+994 50 123 45 67' })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @Matches(PHONE_PATTERN, { message: 'phone must be a valid phone number' })
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(2000)
  bio?: string | null;
}

// PATCH /staff/:userId — the admin edits the work profile (DOC 8.3).
// Name, email and role are auth data: they change through PATCH /users/:id.
export class UpdateStaffDto extends UpdateOwnStaffDto {
  // An inactive department is refused unless it is already the current one
  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  departmentId?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Senior Cardiologist' })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(100)
  title?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Interventional cardiology' })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(100)
  specialization?: string | null;

  // Unique — 409 { field: 'licenseNumber' } when another person has it
  @ApiPropertyOptional({ nullable: true, example: 'AZ-MED-12345' })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(50)
  licenseNumber?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2024-09-01' })
  @IsOptional()
  @Transform(trimToNull)
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'hireDate must be YYYY-MM-DD' })
  hireDate?: string | null;
}
