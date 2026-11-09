import { StaffMember } from './entities/staff-member.entity';

export interface StaffDepartmentRef {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

export interface StaffResponse {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  status: string;
  isActive: boolean;
  department: StaffDepartmentRef | null;
  title: string | null;
  specialization: string | null;
  licenseNumber: string | null;
  phone: string | null;
  hireDate: string | null;
  bio: string | null;
  createdAt: string;
  updatedAt: string;
}

// The staff id other services use is userId; the row's own id stays inside.
// `department` must be loaded with the row.
export const toStaffResponse = (staff: StaffMember): StaffResponse => ({
  userId: staff.userId,
  firstName: staff.firstName,
  lastName: staff.lastName,
  email: staff.email,
  role: staff.role,
  status: staff.status,
  isActive: staff.isActive,
  department: staff.department
    ? {
        id: staff.department.id,
        code: staff.department.code,
        name: staff.department.name,
        isActive: staff.department.isActive,
      }
    : null,
  title: staff.title,
  specialization: staff.specialization,
  licenseNumber: staff.licenseNumber,
  phone: staff.phone,
  hireDate: staff.hireDate,
  bio: staff.bio,
  createdAt: staff.createdAt.toISOString(),
  updatedAt: staff.updatedAt.toISOString(),
});
