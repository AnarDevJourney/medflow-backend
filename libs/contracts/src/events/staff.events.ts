// staff.events — published by staff-service. Aggregate = DEPARTMENT,
// key = department id. History only (DOC 5.6).

export const StaffEvents = {
  DEPARTMENT_CREATED: 'department.created',
  DEPARTMENT_UPDATED: 'department.updated',
} as const;

export interface DepartmentCreatedPayload {
  departmentId: string;
  code: string;
  name: string;
  isActive: boolean;
}

// The department after the change. changedFields holds field NAMES;
// 'isActive' in it = deactivated or reactivated.
export interface DepartmentUpdatedPayload extends DepartmentCreatedPayload {
  changedFields: string[];
}

export interface StaffEventPayloads {
  [StaffEvents.DEPARTMENT_CREATED]: DepartmentCreatedPayload;
  [StaffEvents.DEPARTMENT_UPDATED]: DepartmentUpdatedPayload;
}
