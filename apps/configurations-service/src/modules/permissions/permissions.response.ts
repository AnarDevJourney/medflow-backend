import type { Permission, PermissionGroup, Role } from '@medflow/common';

export type RolePermissions = Record<Role, Permission[]>;

// GET /configurations/permissions — everything the permissions page needs.
// Labels are translated by the frontend (permissions.<code>).
export interface PermissionsMatrixResponse {
  groups: PermissionGroup[];
  permissions: { code: Permission; group: PermissionGroup }[];
  // Checkboxes the admin cannot untick
  locked: Partial<RolePermissions>;
  roles: RolePermissions;
}
