import { HttpStatus } from '@nestjs/common';
import { compare, hash, hashSync } from 'bcryptjs';
import { AppException, ErrorCode } from '@medflow/common';

const BCRYPT_COST = 12;

// Min 8 chars, at least one letter and one digit. bcrypt ignores bytes
// after 72, so longer passwords are rejected instead of silently truncated.
export const PASSWORD_RULES = {
  minLength: 8,
  maxLength: 72,
  letter: /[A-Za-z]/,
  digit: /\d/,
  message:
    'Password must be 8–72 characters and contain at least one letter and one digit',
};

// Second line of defence after the DTO validation
export function assertPasswordPolicy(password: string): void {
  const bytes = Buffer.byteLength(password);
  if (
    password.length < PASSWORD_RULES.minLength ||
    bytes > PASSWORD_RULES.maxLength ||
    !PASSWORD_RULES.letter.test(password) ||
    !PASSWORD_RULES.digit.test(password)
  ) {
    throw new AppException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_ERROR,
      PASSWORD_RULES.message,
      [{ field: 'password', errors: [PASSWORD_RULES.message] }],
    );
  }
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, BCRYPT_COST);
}

export function hashPasswordSync(password: string): string {
  return hashSync(password, BCRYPT_COST);
}

export function verifyPassword(password: string, passwordHash: string) {
  return compare(password, passwordHash);
}
