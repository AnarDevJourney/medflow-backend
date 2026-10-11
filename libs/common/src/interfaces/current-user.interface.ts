import { Role } from '../enums/role.enum';

// Same shape as TaskFlow's req.user, but built from the gateway headers
export interface CurrentUserData {
  id: string;
  role: Role;
  name: string;
}
