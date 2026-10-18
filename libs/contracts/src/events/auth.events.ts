// auth.events — published by auth-service. Aggregate = USER, key = userId.

export const AuthEvents = {
  USER_INVITED: 'user.invited',
  USER_ACTIVATED: 'user.activated',
  USER_UPDATED: 'user.updated',
  USER_DEACTIVATED: 'user.deactivated',
  USER_REACTIVATED: 'user.reactivated',
  USER_SESSION_REVOKED: 'user.session_revoked',
  USER_PASSWORD_RESET_REQUESTED: 'user.password_reset_requested',
  USER_PASSWORD_CHANGED: 'user.password_changed',
} as const;

// staff-service: create the profile (skip when resent) · notification: invite email
export interface UserInvitedPayload {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  departmentId: string | null;
  title: string | null;
  // Contains the raw token — never write it to history. null for the
  // seeded admin (already active, no email to send).
  inviteLink: string | null;
  expiresAt: string | null;
  resent: boolean; // true = resend-invite, the profile already exists
}

export interface UserActivatedPayload {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
}

// staff-service: sync its name / role replica
export interface UserUpdatedPayload {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  avatarFileId: string | null;
  changedFields: string[];
}

// staff-service: is_active = false
export interface UserDeactivatedPayload {
  userId: string;
  email: string;
  role: string;
}

// staff-service: is_active = true. status is INVITED when the user never
// set a password.
export interface UserReactivatedPayload {
  userId: string;
  email: string;
  role: string;
  status: 'ACTIVE' | 'INVITED';
}

// notification: security email + in-app message
export interface UserSessionRevokedPayload {
  userId: string;
  email: string;
  firstName: string;
  familyId: string;
  reason: 'REFRESH_TOKEN_REUSE';
}

// notification: reset email. NOT stored in the action history.
export interface UserPasswordResetRequestedPayload {
  userId: string;
  email: string;
  firstName: string;
  resetLink: string; // contains the raw token
  expiresAt: string;
}

// notification: security email
export interface UserPasswordChangedPayload {
  userId: string;
  email: string;
  firstName: string;
  via: 'RESET' | 'CHANGE';
}

export interface AuthEventPayloads {
  [AuthEvents.USER_INVITED]: UserInvitedPayload;
  [AuthEvents.USER_ACTIVATED]: UserActivatedPayload;
  [AuthEvents.USER_UPDATED]: UserUpdatedPayload;
  [AuthEvents.USER_DEACTIVATED]: UserDeactivatedPayload;
  [AuthEvents.USER_REACTIVATED]: UserReactivatedPayload;
  [AuthEvents.USER_SESSION_REVOKED]: UserSessionRevokedPayload;
  [AuthEvents.USER_PASSWORD_RESET_REQUESTED]: UserPasswordResetRequestedPayload;
  [AuthEvents.USER_PASSWORD_CHANGED]: UserPasswordChangedPayload;
}
