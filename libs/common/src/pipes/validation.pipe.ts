import { HttpStatus, ValidationError, ValidationPipe } from '@nestjs/common';
import { ErrorCode } from '../constants/error-codes';
import { AppException } from '../exceptions/app.exception';

export interface FieldError {
  field: string;
  errors: string[];
}

// Flattens nested class-validator errors into [{ field: 'items.0.dosage', errors: [...] }]
function flatten(errors: ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const own = error.constraints
      ? [{ field, errors: Object.values(error.constraints) }]
      : [];
    return [...own, ...flatten(error.children ?? [], field)];
  });
}

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true, // strip unknown fields
    forbidNonWhitelisted: true,
    transform: true, // auto-convert types (string '1' → number 1)
    transformOptions: { enableImplicitConversion: true },
    exceptionFactory: (errors) =>
      new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        'Validation failed',
        flatten(errors),
      ),
  });
}
