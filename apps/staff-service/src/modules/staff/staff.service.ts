import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  QueryFailedError,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import {
  AppException,
  CurrentUserData,
  ErrorCode,
  likePattern,
  Paginated,
  paginated,
  parseSort,
  Role,
  skipOf,
} from '@medflow/common';
import { StaffEvents } from '@medflow/contracts';
import { OutboxService } from '@medflow/kafka';
import { Department } from '../departments/entities/department.entity';
import {
  ListDoctorsQueryDto,
  ListStaffQueryDto,
  STAFF_SORT_FIELDS,
} from './dto/list-staff-query.dto';
import { UpdateOwnStaffDto, UpdateStaffDto } from './dto/update-staff.dto';
import { StaffMember, StaffStatus } from './entities/staff-member.entity';
import { StaffResponse, toStaffResponse } from './staff.mapper';

const AGGREGATE = 'STAFF_MEMBER';

const EDITABLE_FIELDS = [
  'departmentId',
  'title',
  'specialization',
  'licenseNumber',
  'phone',
  'hireDate',
  'bio',
] as const;

type EditableField = (typeof EDITABLE_FIELDS)[number];

// Sort key → column(s)
const SORT_COLUMNS: Record<(typeof STAFF_SORT_FIELDS)[number], string[]> = {
  name: ['staff.lastName', 'staff.firstName'],
  email: ['staff.email'],
  role: ['staff.role'],
  status: ['staff.status'],
  department: ['department.name'],
  hireDate: ['staff.hireDate'],
  createdAt: ['staff.createdAt'],
};

const notFound = () =>
  new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    'Staff member not found',
  );

// Another person already has this licence number → 409 for the form field
function toConflict(error: unknown): unknown {
  if (!(error instanceof QueryFailedError)) return error;
  const { constraint } = error.driverError as { constraint?: string };
  if (constraint !== 'uq_staff_members_license') return error;
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.CONFLICT,
    'A staff member with this licence number already exists',
    { field: 'licenseNumber' },
  );
}

@Injectable()
export class StaffService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(StaffMember)
    private readonly staff: Repository<StaffMember>,
    private readonly outbox: OutboxService,
  ) {}

  // Directory (DOC 8.3). Without users.read only active staff are listed —
  // invited and deactivated accounts are an admin matter.
  async list(
    query: ListStaffQueryDto,
    viewer: CurrentUserData,
  ): Promise<Paginated<StaffResponse>> {
    const qb = this.baseQuery();
    if (viewer.permissions.includes('users.read')) {
      if (query.status) {
        qb.andWhere('staff.status = :status', { status: query.status });
      }
    } else {
      qb.andWhere('staff.status = :status', { status: StaffStatus.ACTIVE });
    }
    if (query.role) qb.andWhere('staff.role = :role', { role: query.role });
    if (query.departmentId) {
      qb.andWhere('staff.departmentId = :departmentId', {
        departmentId: query.departmentId,
      });
    }
    if (query.search) {
      // Same two expressions as the trigram indexes
      qb.andWhere(
        `((staff.first_name || ' ' || staff.last_name) ILIKE :search
          OR staff.email ILIKE :search)`,
        { search: likePattern(query.search) },
      );
    }

    const sort = parseSort(query.sort, STAFF_SORT_FIELDS, { name: 'ASC' });
    for (const [field, direction] of Object.entries(sort)) {
      for (const column of SORT_COLUMNS[field as keyof typeof SORT_COLUMNS]) {
        qb.addOrderBy(column, direction, 'NULLS LAST');
      }
    }
    qb.addOrderBy('staff.id', 'ASC'); // stable pages when sort values tie

    const [items, total] = await qb
      .skip(skipOf(query))
      .take(query.limit)
      .getManyAndCount();
    return paginated(items.map(toStaffResponse), total, query);
  }

  // Booking pickers: doctors who can work (not deactivated), by name
  async doctors(query: ListDoctorsQueryDto): Promise<StaffResponse[]> {
    const qb = this.baseQuery()
      .where('staff.role = :role', { role: Role.DOCTOR })
      .andWhere('staff.isActive = true');
    if (query.departmentId) {
      qb.andWhere('staff.departmentId = :departmentId', {
        departmentId: query.departmentId,
      });
    }
    const rows = await qb
      .orderBy('staff.lastName', 'ASC')
      .addOrderBy('staff.firstName', 'ASC')
      .getMany();
    return rows.map(toStaffResponse);
  }

  async findOne(userId: string): Promise<StaffResponse> {
    const row = await this.baseQuery()
      .where('staff.userId = :userId', { userId })
      .getOne();
    if (!row) throw notFound();
    return toStaffResponse(row);
  }

  update(
    userId: string,
    dto: UpdateStaffDto,
    actor: CurrentUserData,
  ): Promise<StaffResponse> {
    return this.applyChanges(userId, dto, actor);
  }

  // Only phone and bio: the DTO has no other fields, and the whitelist
  // validation drops anything else the client sends
  updateOwn(
    dto: UpdateOwnStaffDto,
    actor: CurrentUserData,
  ): Promise<StaffResponse> {
    return this.applyChanges(actor.id, dto, actor);
  }

  private baseQuery(): SelectQueryBuilder<StaffMember> {
    return this.staff
      .createQueryBuilder('staff')
      .leftJoinAndSelect('staff.department', 'department');
  }

  // Row lock → two edits of one profile run one after the other, so each
  // event lists what really changed. Nothing changed → no event.
  private async applyChanges(
    userId: string,
    dto: Partial<Record<EditableField, string | null>>,
    actor: CurrentUserData,
  ): Promise<StaffResponse> {
    try {
      const id = await this.dataSource.transaction(async (em) => {
        const row = await em.findOne(StaffMember, {
          where: { userId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!row) throw notFound();

        const changedFields = EDITABLE_FIELDS.filter(
          (field) => dto[field] !== undefined && dto[field] !== row[field],
        );
        if (changedFields.length === 0) return row.id;

        const department = changedFields.includes('departmentId')
          ? await this.assignableDepartment(dto.departmentId!, em)
          : row.departmentId
            ? await em.findOneBy(Department, { id: row.departmentId })
            : null;

        for (const field of changedFields) {
          (row as unknown as Record<EditableField, string | null>)[field] =
            dto[field] ?? null;
        }
        const saved = await em.save(row);
        await this.outbox.add(em, {
          eventType: StaffEvents.STAFF_UPDATED,
          aggregateType: AGGREGATE,
          aggregateId: saved.userId,
          actor,
          payload: {
            userId: saved.userId,
            staffMemberId: saved.id,
            firstName: saved.firstName,
            lastName: saved.lastName,
            role: saved.role,
            departmentId: saved.departmentId,
            departmentName: department?.name ?? null,
            title: saved.title,
            changedFields,
          },
        });
        return saved.id;
      });
      const row = await this.baseQuery()
        .where('staff.id = :id', { id })
        .getOneOrFail();
      return toStaffResponse(row);
    } catch (error) {
      throw toConflict(error);
    }
  }

  // A new department must exist and be active (DOC: inactive departments
  // leave every picker). null = no department.
  private async assignableDepartment(
    id: string | null,
    em: EntityManager,
  ): Promise<Department | null> {
    if (id === null) return null;
    const department = await em.findOneBy(Department, { id });
    if (!department) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.BUSINESS_RULE,
        'Department not found',
        { field: 'departmentId' },
      );
    }
    if (!department.isActive) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.BUSINESS_RULE,
        'This department is inactive',
        { field: 'departmentId' },
      );
    }
    return department;
  }
}
