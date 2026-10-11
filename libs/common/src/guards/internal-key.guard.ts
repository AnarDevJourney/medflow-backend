import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { ErrorCode } from '../constants/error-codes';
import { HEADERS } from '../constants/headers';
import { SKIP_INTERNAL_KEY } from '../decorators/skip-internal-key.decorator';
import { AppException } from '../exceptions/app.exception';

// Rejects every request that does not carry the shared x-internal-key, so a
// service cannot be called around the gateway.
@Injectable()
export class InternalKeyGuard implements CanActivate {
  private readonly expected: Buffer;

  constructor(
    private readonly reflector: Reflector,
    internalApiKey: string,
  ) {
    this.expected = Buffer.from(internalApiKey);
  }

  canActivate(context: ExecutionContext): boolean {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_INTERNAL_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const provided = req.headers[HEADERS.INTERNAL_KEY];

    if (typeof provided !== 'string' || !this.matches(provided)) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.UNAUTHORIZED,
        'Missing or invalid internal key',
      );
    }
    return true;
  }

  private matches(provided: string): boolean {
    const candidate = Buffer.from(provided);
    return (
      candidate.length === this.expected.length &&
      timingSafeEqual(candidate, this.expected)
    );
  }
}
