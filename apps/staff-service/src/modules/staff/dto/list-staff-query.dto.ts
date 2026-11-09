import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto, Role } from '@medflow/common';
import { StaffStatus } from '../entities/staff-member.entity';

export const STAFF_SORT_FIELDS = [
  'name',
  'email',
  'role',
  'status',
  'department',
  'hireDate',
  'createdAt',
] as const;

const trimToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

// GET /staff?search=aysel&role=DOCTOR&departmentId=…&status=ACTIVE&sort=name:asc
export class ListStaffQueryDto extends PaginationQueryDto {
  // Matches the full name or the email
  @ApiPropertyOptional({ example: 'aysel' })
  @IsOptional()
  @Transform(trimToUndefined)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: Role })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  // Only with users.read — everyone else sees active staff only
  @ApiPropertyOptional({ enum: StaffStatus })
  @IsOptional()
  @IsEnum(StaffStatus)
  status?: StaffStatus;
}

// GET /staff/doctors?departmentId=… — booking pickers
export class ListDoctorsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}
