import { SetMetadata } from '@nestjs/common';
import type { Permission } from '../permissions/permissions';

export const PERMISSIONS_KEY = 'permissions';
export const AUTHENTICATED_KEY = 'authenticated';

export interface PermissionRequirement {
  permissions: Permission[];
  mode: 'all' | 'any';
}

// The handler runs only if the user has every listed permission
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata<string, PermissionRequirement>(PERMISSIONS_KEY, {
    permissions,
    mode: 'all',
  });

// At least one of them — e.g. schedules.read or schedules.read_own; the
// service then narrows "own" with CurrentUserData.permissions
export const RequireAnyPermission = (...permissions: Permission[]) =>
  SetMetadata<string, PermissionRequirement>(PERMISSIONS_KEY, {
    permissions,
    mode: 'any',
  });

// Any signed-in user, no permission needed (own profile, own settings)
export const Authenticated = () => SetMetadata(AUTHENTICATED_KEY, true);
