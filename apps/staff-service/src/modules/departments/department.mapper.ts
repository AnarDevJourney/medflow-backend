import { Department } from './entities/department.entity';

export interface DepartmentResponse {
  id: string;
  code: string;
  name: string;
  description: string | null;
  location: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const toDepartmentResponse = (
  department: Department,
): DepartmentResponse => ({
  id: department.id,
  code: department.code,
  name: department.name,
  description: department.description,
  location: department.location,
  phone: department.phone,
  isActive: department.isActive,
  createdAt: department.createdAt.toISOString(),
  updatedAt: department.updatedAt.toISOString(),
});
