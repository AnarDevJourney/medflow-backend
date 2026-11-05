import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import {
  AppException,
  CurrentUserData,
  ErrorCode,
  likePattern,
  Paginated,
  paginated,
  parseSort,
  skipOf,
} from '@medflow/common';
import { StaffEvents } from '@medflow/contracts';
import { OutboxService } from '@medflow/kafka';
import { DepartmentResponse, toDepartmentResponse } from './department.mapper';
import { DepartmentsCache } from './departments.cache';
import { CreateDepartmentDto } from './dto/create-department.dto';
import {
  DEPARTMENT_SORT_FIELDS,
  ListDepartmentsQueryDto,
} from './dto/list-departments-query.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { Department } from './entities/department.entity';

const AGGREGATE = 'DEPARTMENT';

const EDITABLE_FIELDS = [
  'name',
  'description',
  'location',
  'phone',
  'isActive',
] as const;

// Unique constraint → the form field it belongs to
const UNIQUE_FIELDS: Record<string, 'code' | 'name'> = {
  uq_departments_code: 'code',
  uq_departments_name: 'name',
};

// A duplicate code or name → 409 that names the field, for the form
function toConflict(error: unknown): unknown {
  if (!(error instanceof QueryFailedError)) return error;
  const { constraint } = error.driverError as { constraint?: string };
  const field = constraint ? UNIQUE_FIELDS[constraint] : undefined;
  if (!field) return error;
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.CONFLICT,
    `A department with this ${field} already exists`,
    { field },
  );
}

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Department)
    private readonly departments: Repository<Department>,
    private readonly cache: DepartmentsCache,
    private readonly outbox: OutboxService,
  ) {}

  // Pickers (every role, DOC 8.3): active departments, cached
  async listActive(): Promise<DepartmentResponse[]> {
    const cached = await this.cache.get();
    if (cached) return cached;

    const rows = await this.departments.find({
      where: { isActive: true },
      order: { name: 'ASC' },
    });
    const departments = rows.map(toDepartmentResponse);
    await this.cache.set(departments);
    return departments;
  }

  // Management page: inactive ones too, with filters
  async list(
    query: ListDepartmentsQueryDto,
  ): Promise<Paginated<DepartmentResponse>> {
    const qb = this.departments.createQueryBuilder('department');
    if (query.isActive !== undefined) {
      qb.andWhere('department.isActive = :isActive', {
        isActive: query.isActive,
      });
    }
    if (query.search) {
      qb.andWhere(
        `(department.name ILIKE :search
          OR department.code ILIKE :search
          OR department.location ILIKE :search)`,
        { search: likePattern(query.search) },
      );
    }

    const sort = parseSort(query.sort, DEPARTMENT_SORT_FIELDS, { name: 'ASC' });
    for (const [field, direction] of Object.entries(sort)) {
      qb.addOrderBy(`department.${field}`, direction);
    }
    qb.addOrderBy('department.id', 'ASC'); // stable pages when sort values tie

    const [items, total] = await qb
      .skip(skipOf(query))
      .take(query.limit)
      .getManyAndCount();
    return paginated(items.map(toDepartmentResponse), total, query);
  }

  async create(
    dto: CreateDepartmentDto,
    actor: CurrentUserData,
  ): Promise<DepartmentResponse> {
    try {
      const department = await this.dataSource.transaction(async (em) => {
        const saved = await em.save(em.create(Department, dto));
        await this.outbox.add(em, {
          eventType: StaffEvents.DEPARTMENT_CREATED,
          aggregateType: AGGREGATE,
          aggregateId: saved.id,
          actor,
          payload: {
            departmentId: saved.id,
            code: saved.code,
            name: saved.name,
            isActive: saved.isActive,
          },
        });
        return saved;
      });
      await this.cache.clear();
      return toDepartmentResponse(department);
    } catch (error) {
      throw toConflict(error);
    }
  }

  // Edit and deactivate / reactivate (isActive). The row lock makes two
  // admins' edits run one after the other, so each event lists what really
  // changed. Nothing changed → no event.
  async update(
    id: string,
    dto: UpdateDepartmentDto,
    actor: CurrentUserData,
  ): Promise<DepartmentResponse> {
    try {
      const { department, changed } = await this.dataSource.transaction(
        async (em) => {
          const row = await em.findOne(Department, {
            where: { id },
            lock: { mode: 'pessimistic_write' },
          });
          if (!row) {
            throw new AppException(
              HttpStatus.NOT_FOUND,
              ErrorCode.NOT_FOUND,
              'Department not found',
            );
          }

          const changedFields = EDITABLE_FIELDS.filter(
            (field) => dto[field] !== undefined && dto[field] !== row[field],
          );
          if (changedFields.length === 0) {
            return { department: row, changed: false };
          }

          em.merge(Department, row, dto);
          const saved = await em.save(row);
          await this.outbox.add(em, {
            eventType: StaffEvents.DEPARTMENT_UPDATED,
            aggregateType: AGGREGATE,
            aggregateId: saved.id,
            actor,
            payload: {
              departmentId: saved.id,
              code: saved.code,
              name: saved.name,
              isActive: saved.isActive,
              changedFields,
            },
          });
          return { department: saved, changed: true };
        },
      );
      if (changed) await this.cache.clear();
      return toDepartmentResponse(department);
    } catch (error) {
      throw toConflict(error);
    }
  }
}
