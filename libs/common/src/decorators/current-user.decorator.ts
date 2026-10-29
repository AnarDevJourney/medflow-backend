import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { HEADERS } from '../constants/headers';
import { Role } from '../enums/role.enum';
import { CurrentUserData } from '../interfaces/current-user.interface';
import { readPermissionsHeader } from '../permissions/read-permissions-header';

function header(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
}

// Builds the current user from the trusted x-user-* headers set by the
// gateway. Returns null on routes that are called without a user (internal
// calls, system jobs). x-user-name is URI-encoded by the gateway because
// HTTP headers cannot carry non-ASCII names like "Məmmədova".
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserData | null => {
    const req = ctx.switchToHttp().getRequest<Request>();
    const id = header(req, HEADERS.USER_ID);
    const role = header(req, HEADERS.USER_ROLE);
    if (!id || !role) return null;

    return {
      id,
      role: role as Role,
      name: decodeURIComponent(header(req, HEADERS.USER_NAME) ?? ''),
      permissions: readPermissionsHeader(req),
    };
  },
);
