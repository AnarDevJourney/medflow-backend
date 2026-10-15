import { Role } from '@medflow/common';
import { User } from './entities/user.entity';
import { UserStatus } from './entities/user-status.enum';

// What a user sees about themself (login, /auth/me)
export interface ProfileResponse {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: Role;
  avatarFileId: string | null;
}

// What an admin sees in user management
export interface UserResponse extends ProfileResponse {
  status: UserStatus;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export function toProfileResponse(user: User): ProfileResponse {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    avatarFileId: user.avatarFileId,
  };
}

export function toUserResponse(user: User): UserResponse {
  return {
    ...toProfileResponse(user),
    status: user.status,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}
