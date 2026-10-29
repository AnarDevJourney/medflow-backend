import { Role } from '../enums/role.enum';
import type { Permission } from '../permissions/permissions';

// Same shape as TaskFlow's req.user, but built from the gateway headers
export interface CurrentUserData {
  id: string;
  role: Role;
  name: string;
  // The role's permissions — for rules like "read_own vs read" in services
  permissions: readonly Permission[];
}
