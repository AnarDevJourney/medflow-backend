import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In, QueryFailedError } from 'typeorm';
import {
  AppException,
  CurrentUserData,
  ErrorCode,
  Paginated,
  paginated,
  parseSort,
  Role,
  skipOf,
} from '@medflow/common';
import { StaffEvents, TimeOffPayload } from '@medflow/contracts';
import { OutboxService } from '@medflow/kafka';
import {
  StaffMember,
  StaffStatus,
} from '../staff/entities/staff-member.entity';
import { CreateTimeOffDto } from './dto/create-time-off.dto';
import {
  ListTimeOffQueryDto,
  TIME_OFF_SORT_FIELDS,
} from './dto/list-time-off-query.dto';
import { TimeOff } from './entities/time-off.entity';
import {
  clinicToday,
  daysBetween,
  TimeOffResponse,
  toTimeOffResponse,
} from './time-off.mapper';

const AGGREGATE = 'STAFF_MEMBER';
const MAX_DAYS = 365;

const rule = (message: string, field: string) =>
  new AppException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    ErrorCode.BUSINESS_RULE,
    message,
    { field },
  );

const staffNotFound = () =>
  new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    'Staff member not found',
  );

// The exclusion constraint is the real guard: two admins adding
// overlapping periods at once still end with one of them refused
function toConflict(error: unknown): unknown {
  if (!(error instanceof QueryFailedError)) return error;
  const { constraint } = error.driverError as { constraint?: string };
  if (constraint !== 'ex_time_off_overlap') return error;
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.CONFLICT,
    'This period overlaps another time off of this doctor',
    { field: 'startDate' },
  );
}

// Doctors' leave periods (DOC 5.6, 8.3). Same permissions as the weekly
// schedule: schedules.read / read_own to see, schedules.manage to change.
@Injectable()
export class TimeOffService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly outbox: OutboxService,
  ) {}

  async list(
    query: ListTimeOffQueryDto,
    viewer: CurrentUserData,
  ): Promise<Paginated<TimeOffResponse>> {
    let userId = query.userId;
    if (!viewer.permissions.includes('schedules.read')) {
      if (userId && userId !== viewer.id) {
        throw new AppException(
          HttpStatus.FORBIDDEN,
          ErrorCode.FORBIDDEN,
          'You can only view your own time off',
        );
      }
      userId = viewer.id;
    }

    const qb = this.dataSource.manager
      .createQueryBuilder(TimeOff, 't')
      .innerJoinAndSelect('t.staffMember', 'staff');
    if (userId) qb.andWhere('staff.userId = :userId', { userId });
    // Periods touching [from, to]
    if (query.from) qb.andWhere('t.endDate >= :from', { from: query.from });
    if (query.to) qb.andWhere('t.startDate <= :to', { to: query.to });
    if (query.scope) {
      qb.andWhere(
        query.scope === 'upcoming'
          ? 't.endDate >= :today'
          : 't.endDate < :today',
        { today: clinicToday() },
      );
    }

    // Newest first by default, like every list in the app
    const sort = parseSort(query.sort, TIME_OFF_SORT_FIELDS, {
      createdAt: 'DESC',
    });
    for (const [field, direction] of Object.entries(sort)) {
      qb.addOrderBy(`t.${field}`, direction);
    }
    qb.addOrderBy('t.id', 'ASC'); // stable pages when sort values tie

    const [rows, total] = await qb
      .skip(skipOf(query))
      .take(query.limit)
      .getManyAndCount();
    const names = await this.creatorNames(rows, this.dataSource.manager);
    return paginated(
      rows.map((row) =>
        toTimeOffResponse(row, names.get(row.createdBy) ?? null),
      ),
      total,
      query,
    );
  }

  async create(
    dto: CreateTimeOffDto,
    actor: CurrentUserData,
  ): Promise<TimeOffResponse> {
    if (dto.endDate < dto.startDate) {
      throw rule('The end date must not be before the start date', 'endDate');
    }
    const days = daysBetween(dto.startDate, dto.endDate);
    if (days > MAX_DAYS) {
      throw rule(`A period may be at most ${MAX_DAYS} days long`, 'endDate');
    }

    try {
      const id = await this.dataSource.transaction(async (em) => {
        const staff = await this.lockedDoctor(dto.userId, em);
        const row = await em.save(
          em.create(TimeOff, {
            staffMemberId: staff.id,
            type: dto.type,
            startDate: dto.startDate,
            endDate: dto.endDate,
            reason: dto.reason ?? null,
            createdBy: actor.id,
          }),
        );
        await this.outbox.add(em, {
          eventType: StaffEvents.TIME_OFF_CREATED,
          aggregateType: AGGREGATE,
          aggregateId: staff.userId,
          actor,
          payload: this.payloadOf(row, staff),
        });
        return row.id;
      });
      return this.findOne(id);
    } catch (error) {
      throw toConflict(error);
    }
  }

  // Only a period that has not ended yet: an ended one is history (who was
  // away when) and stays
  async remove(id: string, actor: CurrentUserData): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      const found = await em.findOne(TimeOff, {
        where: { id },
        relations: { staffMember: true },
      });
      if (!found) {
        throw new AppException(
          HttpStatus.NOT_FOUND,
          ErrorCode.NOT_FOUND,
          'Time off not found',
        );
      }
      const staff = await this.lockedDoctor(found.staffMember.userId, em);
      if (found.endDate < clinicToday()) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.INVALID_STATUS,
          'A time off that has already ended cannot be removed',
        );
      }
      await em.delete(TimeOff, { id });
      await this.outbox.add(em, {
        eventType: StaffEvents.TIME_OFF_DELETED,
        aggregateType: AGGREGATE,
        aggregateId: staff.userId,
        actor,
        payload: this.payloadOf(found, staff),
      });
    });
  }

  private async findOne(id: string): Promise<TimeOffResponse> {
    const em = this.dataSource.manager;
    const row = await em.findOneOrFail(TimeOff, {
      where: { id },
      relations: { staffMember: true },
    });
    const names = await this.creatorNames([row], em);
    return toTimeOffResponse(row, names.get(row.createdBy) ?? null);
  }

  // Row lock → changes for one doctor run one after the other. Same rules
  // as the weekly schedule: doctors only, a deactivated one is read-only.
  private async lockedDoctor(
    userId: string,
    em: EntityManager,
  ): Promise<StaffMember> {
    const staff = await em.findOne(StaffMember, {
      where: { userId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!staff) throw staffNotFound();
    if (staff.role !== Role.DOCTOR) {
      throw rule('Only doctors have time off in the schedule', 'userId');
    }
    if (staff.status === StaffStatus.DEACTIVATED) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_STATUS,
        'The time off of a deactivated doctor cannot be changed',
      );
    }
    return staff;
  }

  // Who added each period (created_by is an auth user id; admins have a
  // staff profile too)
  private async creatorNames(
    rows: TimeOff[],
    em: EntityManager,
  ): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((row) => row.createdBy))];
    if (ids.length === 0) return new Map();
    const people = await em.findBy(StaffMember, { userId: In(ids) });
    return new Map(
      people.map((p) => [p.userId, `${p.firstName} ${p.lastName}`]),
    );
  }

  private payloadOf(row: TimeOff, staff: StaffMember): TimeOffPayload {
    return {
      timeOffId: row.id,
      userId: staff.userId,
      staffMemberId: staff.id,
      firstName: staff.firstName,
      lastName: staff.lastName,
      type: row.type,
      startDate: row.startDate,
      endDate: row.endDate,
      days: daysBetween(row.startDate, row.endDate),
    };
  }
}
