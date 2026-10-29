import type { Request } from 'express';
import { HEADERS } from '../constants/headers';
import { isPermission, Permission } from './permissions';

// x-user-permissions: "users.read,history.read" → known codes only
export function readPermissionsHeader(req: Request): Permission[] {
  const value = req.headers[HEADERS.USER_PERMISSIONS];
  if (typeof value !== 'string' || value === '') return [];
  return value.split(',').filter(isPermission);
}
