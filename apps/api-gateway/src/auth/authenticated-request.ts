import type { Request } from 'express';
import type { AccessTokenPayload } from '@medflow/common';

// Set by AuthMiddleware, read by ProxyService to build the x-user-* headers
export interface AuthenticatedRequest extends Request {
  auth?: AccessTokenPayload;
  // The role's permission codes, comma-separated → x-user-permissions
  permissions?: string;
}
