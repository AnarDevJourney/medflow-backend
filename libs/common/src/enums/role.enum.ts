// Single global role per user — stored in auth_db, embedded in the JWT and
// forwarded by the gateway as x-user-role.
export enum Role {
  ADMIN = 'ADMIN',
  DOCTOR = 'DOCTOR',
  NURSE = 'NURSE',
  RECEPTIONIST = 'RECEPTIONIST',
  ACCOUNTANT = 'ACCOUNTANT',
}
