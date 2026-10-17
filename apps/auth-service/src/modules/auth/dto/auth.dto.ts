import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PASSWORD_RULES } from '../../../common/password.util';

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

// Password policy (DOC 3.3) — checked again in the service
function NewPassword(): PropertyDecorator {
  return (target, key) => {
    IsString()(target, key);
    MinLength(PASSWORD_RULES.minLength, { message: PASSWORD_RULES.message })(
      target,
      key,
    );
    MaxLength(PASSWORD_RULES.maxLength, { message: PASSWORD_RULES.message })(
      target,
      key,
    );
    Matches(PASSWORD_RULES.letter, { message: PASSWORD_RULES.message })(
      target,
      key,
    );
    Matches(PASSWORD_RULES.digit, { message: PASSWORD_RULES.message })(
      target,
      key,
    );
  };
}

export class LoginDto {
  @ApiProperty({ example: 'admin@medflow.az' })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiProperty({ example: 'Admin12345' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password: string;
}

export class AcceptInviteDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  token: string;

  @ApiProperty({ example: 'Secret123' })
  @NewPassword()
  password: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'aysel.mammadova@medflow.az' })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(255)
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  token: string;

  @ApiProperty({ example: 'NewSecret123' })
  @NewPassword()
  password: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  currentPassword: string;

  @ApiProperty({ example: 'NewSecret123' })
  @NewPassword()
  newPassword: string;
}
