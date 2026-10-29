import { Role } from '../enums/role.enum';

const { ADMIN, DOCTOR, NURSE, RECEPTIONIST, ACCOUNTANT } = Role;
const ALL = Object.values(Role);

export interface PermissionDefinition {
  // Group in the permissions page (one section per module)
  group: PermissionGroup;
  // Roles that get the permission when it first appears (DOC 4.2 matrix).
  // Afterwards only the admin's choices in configurations_db count.
  defaultRoles: readonly Role[];
}

export const PERMISSION_GROUPS = [
  'users',
  'permissions',
  'staff',
  'patients',
  'appointments',
  'encounters',
  'records',
  'lab',
  'billing',
  'files',
  'history',
] as const;

export type PermissionGroup = (typeof PERMISSION_GROUPS)[number];

// Every permission of the system. Endpoints name the one they need with
// @RequirePermission(); which role has it is decided by the admin
// (configurations-service, cached in Redis, sent by the gateway as
// x-user-permissions). Ownership and state rules ("your own visit",
// "must be CHECKED_IN") stay in the service methods.
//
// Codes are stored in the database — never rename one. A new permission
// is added here; configurations-service grants it to its defaultRoles on
// the next start.
export const PERMISSIONS = {
  // auth-service — staff accounts
  'users.read': { group: 'users', defaultRoles: [ADMIN] },
  'users.invite': { group: 'users', defaultRoles: [ADMIN] },
  'users.update': { group: 'users', defaultRoles: [ADMIN] },
  'users.deactivate': { group: 'users', defaultRoles: [ADMIN] },

  // configurations-service — this matrix itself
  'permissions.read': { group: 'permissions', defaultRoles: [ADMIN] },
  'permissions.manage': { group: 'permissions', defaultRoles: [ADMIN] },

  // staff-service
  'departments.read': { group: 'staff', defaultRoles: ALL },
  'departments.manage': { group: 'staff', defaultRoles: [ADMIN] },
  'staff.read': { group: 'staff', defaultRoles: ALL },
  'staff.update': { group: 'staff', defaultRoles: [ADMIN] },
  'schedules.read': { group: 'staff', defaultRoles: [ADMIN, RECEPTIONIST] },
  'schedules.read_own': { group: 'staff', defaultRoles: [DOCTOR] },
  'schedules.manage': { group: 'staff', defaultRoles: [ADMIN] },

  // patient-service
  'patients.read': { group: 'patients', defaultRoles: ALL },
  'patients.create': {
    group: 'patients',
    defaultRoles: [ADMIN, NURSE, RECEPTIONIST],
  },
  'patients.update': {
    group: 'patients',
    defaultRoles: [ADMIN, NURSE, RECEPTIONIST],
  },
  'patients.deactivate': { group: 'patients', defaultRoles: [ADMIN] },
  'patients.clinical_read': {
    group: 'patients',
    defaultRoles: [DOCTOR, NURSE],
  },
  'patients.clinical_manage': {
    group: 'patients',
    defaultRoles: [DOCTOR, NURSE],
  },
  'patients.stats': { group: 'patients', defaultRoles: [ADMIN] },

  // appointment-service
  'appointments.read': {
    group: 'appointments',
    defaultRoles: [ADMIN, DOCTOR, NURSE, RECEPTIONIST],
  },
  'appointments.availability': {
    group: 'appointments',
    defaultRoles: [ADMIN, NURSE, RECEPTIONIST],
  },
  'appointments.book': {
    group: 'appointments',
    defaultRoles: [ADMIN, RECEPTIONIST],
  },
  'appointments.check_in': {
    group: 'appointments',
    defaultRoles: [NURSE, RECEPTIONIST],
  },
  'appointments.stats': { group: 'appointments', defaultRoles: [ADMIN] },
  'appointments.stats_own': { group: 'appointments', defaultRoles: [DOCTOR] },

  // medical-record-service — visits
  'encounters.read': { group: 'encounters', defaultRoles: [DOCTOR, NURSE] },
  'encounters.manage': { group: 'encounters', defaultRoles: [DOCTOR] },
  'vitals.record': { group: 'encounters', defaultRoles: [DOCTOR, NURSE] },
  'diagnoses.manage': { group: 'encounters', defaultRoles: [DOCTOR] },
  'prescriptions.manage': { group: 'encounters', defaultRoles: [DOCTOR] },
  'lab_orders.manage': { group: 'encounters', defaultRoles: [DOCTOR] },

  // medical-record-service — history and lab
  'records.read': { group: 'records', defaultRoles: [DOCTOR, NURSE] },
  'records.stats': { group: 'records', defaultRoles: [ADMIN] },
  'lab.process': { group: 'lab', defaultRoles: [NURSE] },
  'lab.stats': { group: 'lab', defaultRoles: [NURSE] },

  // billing-service
  'invoices.read': {
    group: 'billing',
    defaultRoles: [ADMIN, RECEPTIONIST, ACCOUNTANT],
  },
  'invoices.manage': { group: 'billing', defaultRoles: [ACCOUNTANT] },
  'payments.create': {
    group: 'billing',
    defaultRoles: [RECEPTIONIST, ACCOUNTANT],
  },
  'payments.read': { group: 'billing', defaultRoles: [ACCOUNTANT] },
  'prices.read': { group: 'billing', defaultRoles: [ADMIN, ACCOUNTANT] },
  'prices.manage': { group: 'billing', defaultRoles: [ADMIN, ACCOUNTANT] },
  'billing.stats': { group: 'billing', defaultRoles: [ADMIN, ACCOUNTANT] },

  // file-service
  'files.upload': {
    group: 'files',
    defaultRoles: [ADMIN, DOCTOR, NURSE, RECEPTIONIST],
  },
  'files.patient_documents': {
    group: 'files',
    defaultRoles: [ADMIN, DOCTOR, NURSE, RECEPTIONIST],
  },
  'files.lab_results': { group: 'files', defaultRoles: [DOCTOR, NURSE] },
  'files.delete_any': { group: 'files', defaultRoles: [ADMIN] },

  // notification-history-service
  'history.read': { group: 'history', defaultRoles: [ADMIN] },
  'history.entity_read': {
    group: 'history',
    defaultRoles: [ADMIN, DOCTOR, NURSE, ACCOUNTANT],
  },
  'history.patient_read': {
    group: 'history',
    defaultRoles: [ADMIN, DOCTOR, NURSE],
  },
  'history.user_read': { group: 'history', defaultRoles: [ADMIN] },
  'emails.read': { group: 'history', defaultRoles: [ADMIN] },
} as const satisfies Record<string, PermissionDefinition>;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const isPermission = (value: string): value is Permission =>
  Object.hasOwn(PERMISSIONS, value);

// The admin can never take these from ADMIN — otherwise nobody could open
// or fix the permissions page again
export const LOCKED_ADMIN_PERMISSIONS: readonly Permission[] = [
  'permissions.read',
  'permissions.manage',
];

// Redis cache of one role's permissions (comma-separated codes; '' = none).
// Written by configurations-service, read by the gateway on every request.
export const permissionsCacheKey = (role: Role | string) =>
  `permissions:role:${role}`;
