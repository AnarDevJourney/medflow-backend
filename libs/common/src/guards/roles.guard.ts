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
import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role } from '../enums/role.enum';
import { AppException } from '../exceptions/app.exception';

// Coarse role check from x-user-role. Ownership and state rules
// ("this is your visit", "must be CHECKED_IN") live in service methods.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const role = req.headers[HEADERS.USER_ROLE];

    if (typeof role !== 'string') {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.UNAUTHORIZED,
        'Authentication required',
      );
    }

    if (!requiredRoles.includes(role as Role)) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        `Required role: ${requiredRoles.join(' or ')}`,
      );
    }
    return true;
  }
}
