import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppException, CurrentUserData, ErrorCode } from '@medflow/common';
import { OutboxService } from '../../outbox/outbox.service';
import { SessionsService } from '../sessions/sessions.service';
import { TokenRevocationService } from '../sessions/token-revocation.service';
import { CreateUserDto } from './dto/create-user.dto';
import { User } from './entities/user.entity';
import { UserStatus } from './entities/user-status.enum';
import { InvitationsService } from './invitations.service';
import { toUserResponse, UserResponse } from './user.mapper';

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
        userId: created.id,
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
        userId: user.id,
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
        userId: user.id,
        actor,
        payload: { userId: user.id, email: user.email, role: user.role },
      });
    });

    user.status = UserStatus.DEACTIVATED;
    return toUserResponse(user);
  }

  private async findOrFail(id: string): Promise<User> {
    const user = await this.users.findOneBy({ id });
    if (!user) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'User not found',
      );
    }
    return user;
  }
}
