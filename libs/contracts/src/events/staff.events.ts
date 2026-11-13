// staff.events — published by staff-service. History only (DOC 5.6).
// department.* : aggregate DEPARTMENT, key = department id.
// staff.updated, schedule.updated: aggregate STAFF_MEMBER, key = user id.

export const StaffEvents = {
  DEPARTMENT_CREATED: 'department.created',
  DEPARTMENT_UPDATED: 'department.updated',
  STAFF_UPDATED: 'staff.updated',
  SCHEDULE_UPDATED: 'schedule.updated',
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

// The work profile after an edit by an admin (PATCH /staff/:userId) or by
// the person themselves (PATCH /staff/me, phone and bio). Copies of auth
// data (name, email, role) never cause this event.
export interface StaffUpdatedPayload {
  userId: string;
  staffMemberId: string;
  firstName: string;
  lastName: string;
  role: string;
  departmentId: string | null;
  departmentName: string | null;
  title: string | null;
  changedFields: string[];
}

// One working weekday. ISO day: 1 = Monday … 7 = Sunday; times 'HH:mm'.
export interface ScheduleDayPayload {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  slotMinutes: number;
}

// The doctor's weekly schedule was replaced (PUT /schedules/:userId).
// days = the new week (working days only), previousDays = the week before;
// changedDays = weekdays whose hours were added, changed or removed.
export interface ScheduleUpdatedPayload {
  userId: string;
  staffMemberId: string;
  firstName: string;
  lastName: string;
  days: ScheduleDayPayload[];
  previousDays: ScheduleDayPayload[];
  changedDays: number[];
}

export interface StaffEventPayloads {
  [StaffEvents.DEPARTMENT_CREATED]: DepartmentCreatedPayload;
  [StaffEvents.DEPARTMENT_UPDATED]: DepartmentUpdatedPayload;
  [StaffEvents.STAFF_UPDATED]: StaffUpdatedPayload;
  [StaffEvents.SCHEDULE_UPDATED]: ScheduleUpdatedPayload;
}
