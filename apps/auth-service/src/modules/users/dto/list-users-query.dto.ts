import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto, Role } from '@medflow/common';
import { UserStatus } from '../entities/user-status.enum';

export const USER_SORT_FIELDS = [
  'createdAt',
  'lastName',
  'email',
  'lastLoginAt',
] as const;

// sort accepts USER_SORT_FIELDS, e.g. lastName:asc
// GET /users?role=DOCTOR&status=ACTIVE&search=aysel&page=1&limit=20&sort=lastName:asc
export class ListUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: Role })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  // Matches first name, last name, full name or email
  @ApiPropertyOptional({ example: 'aysel' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsString()
  @MaxLength(100)
  search?: string;
}
