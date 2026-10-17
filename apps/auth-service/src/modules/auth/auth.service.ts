import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { AppException, CurrentUserData, ErrorCode } from '@medflow/common';
import { generateToken, sha256 } from '../../common/crypto.util';
import {
  assertPasswordPolicy,
  hashPassword,
  hashPasswordSync,
  verifyPassword,
} from '../../common/password.util';
import { RequestMeta } from '../../common/request-meta';
import { AuthConfigService } from '../../config/auth-config.service';
import { OutboxService } from '../../outbox/outbox.service';
import { IssuedTokens, SessionsService } from '../sessions/sessions.service';
import { TokenRevocationService } from '../sessions/token-revocation.service';
import { Invitation } from '../users/entities/invitation.entity';
import { User } from '../users/entities/user.entity';
import { UserStatus } from '../users/entities/user-status.enum';
import { InvitationsService } from '../users/invitations.service';
import { UpdateProfileDto } from '../users/dto/update-user.dto';
import { ProfileResponse, toProfileResponse } from '../users/user.mapper';
import { UsersService } from '../users/users.service';
import {
  AcceptInviteDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  ResetPasswordDto,
} from './dto/auth.dto';
import { PasswordReset } from './entities/password-reset.entity';

const RESET_TTL_MS = 60 * 60 * 1000;

export interface SessionResult {
  user: ProfileResponse;
  tokens: IssuedTokens;
}

export interface InvitationPreview {
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  expiresAt: Date;
}

const invalidCredentials = () =>
  new AppException(
    HttpStatus.UNAUTHORIZED,
    ErrorCode.UNAUTHORIZED,
    'Invalid email or password',
  );

const passwordFieldError = (field: string, message: string) =>
  new AppException(
    HttpStatus.BAD_REQUEST,
    ErrorCode.VALIDATION_ERROR,
    message,
    [{ field, errors: [message] }],
  );

const invalidResetToken = () =>
  new AppException(
    HttpStatus.BAD_REQUEST,
    ErrorCode.BAD_REQUEST,
    'Reset link is invalid or has expired',
  );

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  // Compared against when the email does not exist, so a wrong email takes
  // as long as a wrong password (no account enumeration by timing)
  private readonly dummyHash = hashPasswordSync(randomUUID());

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly sessions: SessionsService,
    private readonly revocation: TokenRevocationService,
    private readonly invitations: InvitationsService,
    private readonly usersService: UsersService,
    private readonly outbox: OutboxService,
    private readonly config: AuthConfigService,
  ) {}

  // DOC 3.2. Unknown email, INVITED, DEACTIVATED and wrong password all get
  // the same 401 on purpose.
  async login(dto: LoginDto, meta: RequestMeta): Promise<SessionResult> {
    const user = await this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email: dto.email })
      .getOne();

    const passwordOk = await verifyPassword(
      dto.password,
      user?.passwordHash ?? this.dummyHash,
    );
    if (!user || !passwordOk || user.status !== UserStatus.ACTIVE) {
      throw invalidCredentials();
    }

    const tokens = await this.dataSource.transaction(async (em) => {
      const issued = await this.sessions.issue(em, user, meta);
      await em.update(User, user.id, { lastLoginAt: new Date() });
      return issued;
    });
    return { user: toProfileResponse(user), tokens: pickTokens(tokens) };
  }

  async refresh(
    rawRefreshToken: string | undefined,
    meta: RequestMeta,
  ): Promise<SessionResult> {
    const { user, tokens } = await this.sessions.rotate(rawRefreshToken, meta);
    return { user: toProfileResponse(user), tokens };
  }

  logout(rawAccessToken?: string, rawRefreshToken?: string): Promise<void> {
    return this.sessions.logout(rawAccessToken, rawRefreshToken);
  }

  async me(userId: string): Promise<ProfileResponse> {
    const user = await this.users.findOneBy({ id: userId });
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.UNAUTHORIZED,
        'Authentication required',
      );
    }
    return toProfileResponse(user);
  }

  updateMe(
    actor: CurrentUserData,
    dto: UpdateProfileDto,
  ): Promise<ProfileResponse> {
    return this.usersService.updateProfile(actor, dto);
  }

  // DOC 8.2: new password, every *other* session revoked, this one continues
  // with fresh tokens (the old access token dies with the rest).
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    rawRefreshToken: string | undefined,
    meta: RequestMeta,
  ): Promise<SessionResult> {
    assertPasswordPolicy(dto.newPassword);

    const user = await this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.id = :id', { id: userId })
      .getOne();
    if (!user?.passwordHash || user.status !== UserStatus.ACTIVE) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.UNAUTHORIZED,
        'Authentication required',
      );
    }
    if (!(await verifyPassword(dto.currentPassword, user.passwordHash))) {
      throw passwordFieldError(
        'currentPassword',
        'Current password is incorrect',
      );
    }
    if (dto.newPassword === dto.currentPassword) {
      throw passwordFieldError(
        'newPassword',
        'New password must be different from the current one',
      );
    }
    const passwordHash = await hashPassword(dto.newPassword);

    // Redis first: if it fails nothing has changed yet
    await this.revocation.revokeAllTokens(user.id);

    const tokens = await this.dataSource.transaction(async (em) => {
      const now = new Date();
      await em.update(User, user.id, { passwordHash, passwordChangedAt: now });
      // Reset links sent before the change must not work any more
      await em.update(
        PasswordReset,
        { userId: user.id, usedAt: IsNull() },
        { usedAt: now },
      );
      const issued = await this.sessions.revokeOtherSessions(
        em,
        user,
        rawRefreshToken,
        meta,
      );

      await this.outbox.add(em, {
        eventType: 'user.password_changed',
        userId: user.id,
        actor: { id: user.id, name: user.fullName, role: user.role },
        payload: {
          userId: user.id,
          email: user.email,
          firstName: user.firstName,
          via: 'CHANGE',
        },
      });
      return issued;
    });

    return { user: toProfileResponse(user), tokens };
  }

  // DOC 3.3 step 5: data for the "set your password" form
  async previewInvitation(rawToken: string): Promise<InvitationPreview> {
    const { invitation, user } = await this.invitations.findPending(
      this.dataSource.manager,
      rawToken,
    );
    return {
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      expiresAt: invitation.expiresAt,
    };
  }

  // DOC 3.3 step 6: set password → ACTIVE → logged in immediately
  async acceptInvite(
    dto: AcceptInviteDto,
    meta: RequestMeta,
  ): Promise<SessionResult> {
    assertPasswordPolicy(dto.password);
    const passwordHash = await hashPassword(dto.password); // slow, keep out of the tx

    return this.dataSource.transaction(async (em) => {
      const { invitation, user } = await this.invitations.findPending(
        em,
        dto.token,
        true,
      );
      const now = new Date();

      await em.update(User, user.id, {
        status: UserStatus.ACTIVE,
        passwordHash,
        passwordChangedAt: now,
        lastLoginAt: now,
      });
      user.status = UserStatus.ACTIVE;
      await em.update(Invitation, invitation.id, { acceptedAt: now });

      await this.outbox.add(em, {
        eventType: 'user.activated',
        userId: user.id,
        actor: { id: user.id, name: user.fullName, role: user.role },
        payload: {
          userId: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
        },
      });

      const tokens = await this.sessions.issue(em, user, meta);
      return { user: toProfileResponse(user), tokens: pickTokens(tokens) };
    });
  }

  // DOC 3.5: always the same answer, whether the email exists or not
  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    const user = await this.users.findOneBy({ email: dto.email });
    if (!user || user.status !== UserStatus.ACTIVE) return;

    const token = generateToken(32);
    const expiresAt = new Date(Date.now() + RESET_TTL_MS);
    const link = `${this.config.frontendUrl}/reset-password?token=${token}`;

    await this.dataSource.transaction(async (em) => {
      // Only the newest link works
      await em.update(
        PasswordReset,
        { userId: user.id, usedAt: IsNull() },
        { usedAt: new Date() },
      );
      await em.insert(PasswordReset, {
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt,
      });
      await this.outbox.add(em, {
        eventType: 'user.password_reset_requested',
        userId: user.id,
        actor: null,
        payload: {
          userId: user.id,
          email: user.email,
          firstName: user.firstName,
          resetLink: link,
          expiresAt: expiresAt.toISOString(),
        },
      });
    });

    if (this.config.logAuthLinks) {
      // TODO(phase 4): the reset email replaces this log line
      this.logger.log(`Password reset link for ${user.email}: ${link}`);
    }
  }

  // DOC 3.5: new password, token used, every session of the user revoked
  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    assertPasswordPolicy(dto.password);

    const pending = await this.findValidReset(
      this.dataSource.manager,
      dto.token,
    );
    const passwordHash = await hashPassword(dto.password);

    // Live access tokens die first; if Redis fails nothing has changed yet
    await this.revocation.revokeAllTokens(pending.userId);

    await this.dataSource.transaction(async (em) => {
      // Re-check under a row lock — the same link may be submitted twice
      const reset = await this.findValidReset(em, dto.token, true);
      const user = await em.findOneBy(User, { id: reset.userId });
      if (!user || user.status !== UserStatus.ACTIVE) throw invalidResetToken();

      const now = new Date();
      await em.update(User, user.id, { passwordHash, passwordChangedAt: now });
      await em.update(
        PasswordReset,
        { userId: user.id, usedAt: IsNull() },
        { usedAt: now },
      );
      await this.sessions.revokeAllRefreshTokens(em, user.id);

      await this.outbox.add(em, {
        eventType: 'user.password_changed',
        userId: user.id,
        actor: { id: user.id, name: user.fullName, role: user.role },
        payload: {
          userId: user.id,
          email: user.email,
          firstName: user.firstName,
          via: 'RESET',
        },
      });
    });
  }

  private async findValidReset(
    em: EntityManager,
    rawToken: string,
    lock = false,
  ): Promise<PasswordReset> {
    const reset = await em.findOne(PasswordReset, {
      where: { tokenHash: sha256(rawToken) },
      ...(lock && { lock: { mode: 'pessimistic_write' as const } }),
    });
    if (!reset || reset.usedAt || reset.expiresAt.getTime() <= Date.now()) {
      throw invalidResetToken();
    }
    return reset;
  }
}

function pickTokens(tokens: IssuedTokens): IssuedTokens {
  return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
}
