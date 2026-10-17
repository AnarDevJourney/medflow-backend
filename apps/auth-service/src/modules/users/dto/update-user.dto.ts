import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Role } from '@medflow/common';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Fields a user may change about themself (PATCH /auth/me)
export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Aysel' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Məmmədova' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName?: string;

  // null removes the avatar.
  // TODO(phase 10): check with file-service that the file is the user's avatar
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsUUID()
  avatarFileId?: string | null;
}

// What an admin may change (PATCH /users/:id, DOC 8.2: name or role).
// Email is the login and is not editable.
export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'Aysel' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Məmmədova' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional({ enum: Role })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}
