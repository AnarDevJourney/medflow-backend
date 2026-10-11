import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { DEFAULT_ERROR_CODES, ErrorCode } from '../constants/error-codes';
import { HEADERS } from '../constants/headers';

interface NormalizedError {
  statusCode: number;
  code: string;
  message: string;
  details: unknown;
}

// PostgreSQL error codes that are caused by the client, not by a bug
const PG_ERRORS: Record<string, Omit<NormalizedError, 'details'>> = {
  '23505': {
    statusCode: HttpStatus.CONFLICT,
    code: ErrorCode.CONFLICT,
    message: 'A record with the same unique value already exists',
  },
  '23P01': {
    statusCode: HttpStatus.CONFLICT,
    code: ErrorCode.SLOT_TAKEN,
    message: 'This time slot is no longer available',
  },
  '23503': {
    statusCode: HttpStatus.BAD_REQUEST,
    code: ErrorCode.BAD_REQUEST,
    message: 'A referenced record does not exist',
  },
  '23514': {
    statusCode: HttpStatus.BAD_REQUEST,
    code: ErrorCode.BAD_REQUEST,
    message: 'The data violates a database rule',
  },
};

// Every error leaves a service in the same shape:
// { success: false, error: { statusCode, code, message, path, requestId, details } }
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const error = this.normalize(exception);

    if (error.statusCode >= 500) {
      this.logger.error(
        `${request.method} ${request.originalUrl} — ${error.statusCode}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(error.statusCode).json({
      success: false,
      error: {
        statusCode: error.statusCode,
        code: error.code,
        message: error.message,
        path: request.originalUrl,
        requestId: request.headers[HEADERS.REQUEST_ID] ?? null,
        details: error.details,
      },
    });
  }

  private normalize(exception: unknown): NormalizedError {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const body = exception.getResponse();
      const fallbackCode =
        DEFAULT_ERROR_CODES[statusCode] ?? ErrorCode.INTERNAL_ERROR;

      if (typeof body === 'string') {
        return { statusCode, code: fallbackCode, message: body, details: null };
      }

      const obj = body as Record<string, unknown>;

      // Nest built-ins: { statusCode, message, error } — message may be an array
      if ('message' in obj) {
        const message = Array.isArray(obj.message)
          ? obj.message.join('; ')
          : String(obj.message);
        return {
          statusCode,
          code: typeof obj.code === 'string' ? obj.code : fallbackCode,
          message,
          details: obj.details ?? null,
        };
      }

      // Bodies without a message (e.g. terminus health results) go to details
      return {
        statusCode,
        code: fallbackCode,
        message: exception.message,
        details: obj,
      };
    }

    if (exception instanceof QueryFailedError) {
      const pgCode = (exception.driverError as { code?: string } | undefined)
        ?.code;
      const mapped = pgCode ? PG_ERRORS[pgCode] : undefined;
      if (mapped) return { ...mapped, details: null };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Internal server error',
      details: null,
    };
  }
}
