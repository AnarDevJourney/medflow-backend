import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ErrorCode } from '../constants/error-codes';
import { HEADERS } from '../constants/headers';
import {
  AUTHENTICATED_KEY,
  PERMISSIONS_KEY,
  PermissionRequirement,
} from '../decorators/require-permission.decorator';
import { AppException } from '../exceptions/app.exception';
import { readPermissionsHeader } from '../permissions/read-permissions-header';

// Coarse check: does x-user-permissions (the role's permissions, set by the
// gateway from Redis) contain what @RequirePermission() asks for?
// Ownership and state rules ("this is your visit", "must be CHECKED_IN")
// live in service methods.
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const required = this.reflector.getAllAndOverride<
      PermissionRequirement | undefined
    >(PERMISSIONS_KEY, targets);
    const authenticated = this.reflector.getAllAndOverride<boolean>(
      AUTHENTICATED_KEY,
      targets,
    );
    if (!required && !authenticated) return true;

    const req = context.switchToHttp().getRequest<Request>();
    if (typeof req.headers[HEADERS.USER_ID] !== 'string') {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.UNAUTHORIZED,
        'Authentication required',
      );
    }
    if (!required || required.permissions.length === 0) return true;

    const granted = new Set(readPermissionsHeader(req));
    const missing = required.permissions.filter((p) => !granted.has(p));
    const allowed =
      required.mode === 'all'
        ? missing.length === 0
        : missing.length < required.permissions.length;

    if (!allowed) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        `Missing permission: ${missing.join(required.mode === 'all' ? ' and ' : ' or ')}`,
      );
    }
    return true;
  }
}
