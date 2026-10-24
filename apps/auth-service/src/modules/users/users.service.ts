import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  AppException,
  CurrentUserData,
  ErrorCode,
  Paginated,
  paginated,
  parseSort,
  skipOf,
} from '@medflow/common';
import { OutboxService } from '@medflow/kafka';
import { SessionsService } from '../sessions/sessions.service';
import { TokenRevocationService } from '../sessions/token-revocation.service';
import { CreateUserDto } from './dto/create-user.dto';
import {
  ListUsersQueryDto,
  USER_SORT_FIELDS,
} from './dto/list-users-query.dto';
import { UpdateProfileDto, UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';
import { UserStatus } from './entities/user-status.enum';
import { InvitationsService } from './invitations.service';
import {
  ProfileResponse,
  toProfileResponse,
  toUserResponse,
  UserResponse,
} from './user.mapper';

type UserChanges = Partial<
  Pick<User, 'firstName' | 'lastName' | 'role' | 'avatarFileId'>
>;

// Escapes LIKE wildcards so a search for "50%" matches literally
const likePattern = (search: string) =>
  `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

@Injectable()
export class UsersService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly invitations: InvitationsService,
    private readonly sessions: SessionsService,
    private readonly revocation: TokenRevocationService,
    private readonly outbox: OutboxService,
  ) {}

  async list(query: ListUsersQueryDto): Promise<Paginated<UserResponse>> {
    const qb = this.users.createQueryBuilder('user');
    if (query.role) qb.andWhere('user.role = :role', { role: query.role });
    if (query.status) {
      qb.andWhere('user.status = :status', { status: query.status });
    }
    if (query.search) {
      // The full name also matches a first or last name alone. Only these
      // two expressions: each has a trigram index (AddUserSearchIndexes),
      // and one more unindexed OR would force a full table scan.
      qb.andWhere(
        `((user.firstName || ' ' || user.lastName) ILIKE :search
          OR user.email ILIKE :search)`,
        { search: likePattern(query.search) },
      );
    }

    const sort = parseSort(query.sort, USER_SORT_FIELDS, { createdAt: 'DESC' });
    for (const [field, direction] of Object.entries(sort)) {
      qb.addOrderBy(`user.${field}`, direction, 'NULLS LAST');
    }
    qb.addOrderBy('user.id', 'ASC'); // stable pages when sort values tie

    const [items, total] = await qb
      .skip(skipOf(query))
      .take(query.limit)
      .getManyAndCount();
    return paginated(items.map(toUserResponse), total, query);
  }

  async findOne(id: string): Promise<UserResponse> {
    return toUserResponse(await this.findOrFail(id));
  }

  // Admin edits name / role. A role change kills the user's live access
  // tokens, so the new role applies on the next request (the frontend
  // refreshes and gets a token with the new role) instead of in 15 min.
  async update(
    id: string,
    dto: UpdateUserDto,
    actor: CurrentUserData,
  ): Promise<UserResponse> {
    const user = await this.findOrFail(id);
    if (dto.role && dto.role !== user.role && id === actor.id) {
      // Also keeps the last admin from locking everybody out
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.BUSINESS_RULE,
        'You cannot change your own role',
      );
    }

    const changes = diff(user, dto);
    if (!changes) return toUserResponse(user);

    if (changes.role) await this.revocation.revokeAllTokens(user.id);
    await this.dataSource.transaction((em) =>
      this.applyChanges(em, user, changes, actor),
    );
    return toUserResponse(user);
  }

  // PATCH /auth/me — own name and avatar. The name inside the access token
  // catches up on the next refresh.
  async updateProfile(
    actor: CurrentUserData,
    dto: UpdateProfileDto,
  ): Promise<ProfileResponse> {
    const user = await this.findOrFail(actor.id);
    if (user.status !== UserStatus.ACTIVE) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.UNAUTHORIZED,
        'Authentication required',
      );
    }

    const changes = diff(user, dto);
    if (changes) {
      await this.dataSource.transaction((em) =>
        this.applyChanges(em, user, changes, actor),
      );
    }
    return toProfileResponse(user);
  }

  // DOC 3.3 step 1–2: user (INVITED, no password) + invitation + user.invited
  // in one transaction. staff-service and notification-history react to the event.
  async invite(
    dto: CreateUserDto,
    actor: CurrentUserData,
  ): Promise<UserResponse> {
    if (await this.users.existsBy({ email: dto.email })) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.CONFLICT,
        'A user with this email already exists',
      );
    }

    const user = await this.dataSource.transaction(async (em) => {
      const created = await em.save(
        em.create(User, {
          email: dto.email,
          firstName: dto.firstName,
          lastName: dto.lastName,
          role: dto.role,
          status: UserStatus.INVITED,
          createdBy: actor.id,
        }),
      );
      const invitation = await this.invitations.create(em, created, actor.id);
      await this.outbox.add(em, {
        eventType: 'user.invited',
        aggregateType: 'USER',
        aggregateId: created.id,
        actor,
        payload: {
          userId: created.id,
          email: created.email,
          firstName: created.firstName,
          lastName: created.lastName,
          role: created.role,
          departmentId: dto.departmentId ?? null,
          title: dto.title ?? null,
          inviteLink: invitation.link,
          expiresAt: invitation.expiresAt.toISOString(),
          resent: false,
        },
      });
      return created;
    });

    return toUserResponse(user);
  }

  // New token, old link stops working. Only while the user is still INVITED.
  async resendInvite(
    id: string,
    actor: CurrentUserData,
  ): Promise<UserResponse> {
    const user = await this.findOrFail(id);
    if (user.status !== UserStatus.INVITED) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_STATUS,
        'Only users who have not accepted their invite can be re-invited',
      );
    }

    await this.dataSource.transaction(async (em) => {
      const invitation = await this.invitations.create(em, user, actor.id);
      await this.outbox.add(em, {
        eventType: 'user.invited',
        aggregateType: 'USER',
        aggregateId: user.id,
        actor,
        payload: {
          userId: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          departmentId: null,
          title: null,
          inviteLink: invitation.link,
          expiresAt: invitation.expiresAt.toISOString(),
          // staff-service already has the profile — only the email is resent
          resent: true,
        },
      });
    });

    return toUserResponse(user);
  }

  // DOC 3.5: DEACTIVATED + every session revoked. Live access tokens are
  // killed through Redis right away, so the user is locked out instantly.
  async deactivate(id: string, actor: CurrentUserData): Promise<UserResponse> {
    if (id === actor.id) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.BUSINESS_RULE,
        'You cannot deactivate your own account',
      );
    }

    const user = await this.findOrFail(id);
    if (user.status === UserStatus.DEACTIVATED) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_STATUS,
        'User is already deactivated',
      );
    }

    // Redis first: if it fails nothing has changed and the admin can retry
    await this.revocation.revokeAllTokens(user.id);
    await this.dataSource.transaction(async (em) => {
      await em.update(User, user.id, { status: UserStatus.DEACTIVATED });
      await this.sessions.revokeAllRefreshTokens(em, user.id);
      await this.outbox.add(em, {
        eventType: 'user.deactivated',
        aggregateType: 'USER',
        aggregateId: user.id,
        actor,
        payload: { userId: user.id, email: user.email, role: user.role },
      });
    });

    user.status = UserStatus.DEACTIVATED;
    return toUserResponse(user);
  }

  // Undoes a deactivation. A user who never set a password goes back to
  // INVITED (the admin then resends the invite), everyone else to ACTIVE.
  // They log in again themselves — all sessions were revoked on deactivation.
  async reactivate(id: string, actor: CurrentUserData): Promise<UserResponse> {
    const user = await this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.id = :id', { id })
      .getOne();
    if (!user) throw userNotFound();
    if (user.status !== UserStatus.DEACTIVATED) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_STATUS,
        'Only deactivated users can be reactivated',
      );
    }

    const status = user.passwordHash ? UserStatus.ACTIVE : UserStatus.INVITED;
    await this.dataSource.transaction(async (em) => {
      await em.update(User, user.id, { status });
      await this.outbox.add(em, {
        eventType: 'user.reactivated',
        aggregateType: 'USER',
        aggregateId: user.id,
        actor,
        payload: {
          userId: user.id,
          email: user.email,
          role: user.role,
          status,
        },
      });
    });

    user.status = status;
    return toUserResponse(user);
  }

  // Saves the changes and publishes user.updated (staff-service keeps its
  // name / role replica in sync). Mutates `user` to the new values.
  private async applyChanges(
    em: EntityManager,
    user: User,
    changes: UserChanges,
    actor: CurrentUserData,
  ): Promise<void> {
    await em.update(User, user.id, changes);
    Object.assign(user, changes);
    await this.outbox.add(em, {
      eventType: 'user.updated',
      aggregateType: 'USER',
      aggregateId: user.id,
      actor,
      payload: {
        userId: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        avatarFileId: user.avatarFileId,
        changedFields: Object.keys(changes),
      },
    });
  }

  private async findOrFail(id: string): Promise<User> {
    const user = await this.users.findOneBy({ id });
    if (!user) throw userNotFound();
    return user;
  }
}

const userNotFound = () =>
  new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'User not found');

// Only the fields that really change; null when nothing does
function diff(user: User, dto: UserChanges): UserChanges | null {
  const changes: UserChanges = {};
  for (const key of [
    'firstName',
    'lastName',
    'role',
    'avatarFileId',
  ] as const) {
    const value = dto[key];
    if (value !== undefined && value !== user[key]) {
      Object.assign(changes, { [key]: value });
    }
  }
  return Object.keys(changes).length ? changes : null;
}
