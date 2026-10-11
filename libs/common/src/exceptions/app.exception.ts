import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../constants/error-codes';

export interface AppExceptionBody {
  code: ErrorCode;
  message: string;
  details: unknown;
}

// Business error with an explicit error code, e.g.
// throw new AppException(HttpStatus.CONFLICT, ErrorCode.SLOT_TAKEN, 'This time slot was just taken')
export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    code: ErrorCode,
    message: string,
    details: unknown = null,
  ) {
    super({ code, message, details } satisfies AppExceptionBody, status);
  }
}
