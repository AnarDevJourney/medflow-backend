import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { AccessTokenPayload, AppException, ErrorCode } from '@medflow/common';
import { RequestMeta } from '../../common/request-meta';
import { generateToken, sha256 } from '../../common/crypto.util';
import { AuthConfigService } from '../../config/auth-config.service';
import { OutboxService } from '@medflow/kafka';
import { User } from '../users/entities/user.entity';
import { UserStatus } from '../users/entities/user-status.enum';
import { RefreshToken } from './entities/refresh-token.entity';
import { TokenRevocationService } from './token-revocation.service';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
}

type RotateResult =
  | { kind: 'rotated'; user: User; tokens: IssuedTokens }
  | { kind: 'reused'; userId: string; familyId: string };

const sessionExpired = () =>
  new AppException(
    HttpStatus.UNAUTHORIZED,
    ErrorCode.UNAUTHORIZED,
    'Session expired, please log in again',
  );

// Access JWTs + refresh-token families (DOC 3.1, 3.4, 3.5).
@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly jwt: JwtService,
    private readonly config: AuthConfigService,
    private readonly revocation: TokenRevocationService,
    private readonly outbox: OutboxService,
  ) {}

  // New login (familyId omitted) or a rotation inside an existing family
  async issue(
    em: EntityManager,
    user: User,
    meta: RequestMeta,
    familyId: string = randomUUID(),
  ): Promise<IssuedTokens & { refreshTokenId: string }> {
    const refreshToken = generateToken(64);
    const row = em.create(RefreshToken, {
      userId: user.id,
      familyId,
      tokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + this.config.refreshTtlSeconds * 1000),
      userAgent: meta.userAgent,
      ipAddress: meta.ip,
    });
    await em.save(row);

    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        role: user.role,
        name: user.fullName,
        email: user.email,
        iatMs: Date.now(),
      },
      { jwtid: randomUUID() },
    );

    return { accessToken, refreshToken, refreshTokenId: row.id };
  }

  // Each refresh token works exactly once. Presenting a rotated (revoked)
  // token again means it was stolen: the whole family dies (DOC 3.4).
  async rotate(
    rawRefreshToken: string | undefined,
    meta: RequestMeta,
  ): Promise<{ user: User; tokens: IssuedTokens }> {
    if (!rawRefreshToken) throw sessionExpired();

    const result = await this.dataSource.transaction(
      async (em): Promise<RotateResult> => {
        // Row lock: two parallel refreshes with the same token are serialized,
        // the second one sees replaced_by and is treated as reuse
        const current = await em.findOne(RefreshToken, {
          where: { tokenHash: sha256(rawRefreshToken) },
          lock: { mode: 'pessimistic_write' },
        });
        if (!current) throw sessionExpired();
        // Rotated already (replaced_by set) → someone replays an old token.
        // Revoked without a successor (logout, family already killed) → just 401.
        if (current.revokedAt && current.replacedBy) {
          return {
            kind: 'reused',
            userId: current.userId,
            familyId: current.familyId,
          };
        }
        if (current.revokedAt) throw sessionExpired();
        if (current.expiresAt.getTime() <= Date.now()) throw sessionExpired();

        const user = await em.findOneBy(User, { id: current.userId });
        if (!user || user.status !== UserStatus.ACTIVE) throw sessionExpired();

        const next = await this.issue(em, user, meta, current.familyId);
        await em.update(RefreshToken, current.id, {
          revokedAt: new Date(),
          replacedBy: next.refreshTokenId,
        });

        return {
          kind: 'rotated',
          user,
          tokens: {
            accessToken: next.accessToken,
            refreshToken: next.refreshToken,
          },
        };
      },
    );

    if (result.kind === 'reused') {
      await this.handleReuse(result.userId, result.familyId);
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.UNAUTHORIZED,
        'Session has been revoked, please log in again',
      );
    }
    return { user: result.user, tokens: result.tokens };
  }

  private async handleReuse(userId: string, familyId: string): Promise<void> {
    this.logger.warn(
      `Refresh token reuse detected — revoking family ${familyId} of user ${userId}`,
    );
    // Access tokens first: if Redis fails, nothing is half-done
    await this.revocation.revokeAllTokens(userId);
    await this.dataSource.transaction(async (em) => {
      await em.update(
        RefreshToken,
        { familyId, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
      // email + name travel with the event, so the security email needs no
      // call back to auth (fat event, DOC 5.6)
      const user = await em.findOneByOrFail(User, { id: userId });
      await this.outbox.add(em, {
        eventType: 'user.session_revoked',
        aggregateType: 'USER',
        aggregateId: userId,
        actor: null,
        payload: {
          userId,
          email: user.email,
          firstName: user.firstName,
          familyId,
          reason: 'REFRESH_TOKEN_REUSE',
        },
      });
    });
  }

  // Logout: block the presented access token for the rest of its lifetime
  // (a stolen copy stops working now, not in up to 15 min) and revoke the
  // refresh-token family. Works with either cookie alone.
  async logout(
    rawAccessToken: string | undefined,
    rawRefreshToken: string | undefined,
  ): Promise<void> {
    if (rawAccessToken) {
      const payload = await this.verifyAccessToken(rawAccessToken);
      if (payload) await this.revocation.blockToken(payload.jti, payload.exp);
    }

    if (rawRefreshToken) {
      const token = await this.dataSource.manager.findOneBy(RefreshToken, {
        tokenHash: sha256(rawRefreshToken),
      });
      if (token) {
        await this.dataSource.manager.update(
          RefreshToken,
          { familyId: token.familyId, revokedAt: IsNull() },
          { revokedAt: new Date() },
        );
      }
    }
  }

  // Every session of a user: refresh tokens in the caller's transaction.
  // Call revocation.revokeAllTokens() as well to kill live access tokens.
  async revokeAllRefreshTokens(em: EntityManager, userId: string) {
    await em.update(
      RefreshToken,
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  // Password change: every refresh token of the user is revoked, but the
  // caller stays logged in — the presented refresh token is rotated inside
  // its own family, so only the *other* sessions end. A missing, expired or
  // already revoked token just gets a brand-new session.
  async revokeOtherSessions(
    em: EntityManager,
    user: User,
    rawRefreshToken: string | undefined,
    meta: RequestMeta,
  ): Promise<IssuedTokens> {
    const current = rawRefreshToken
      ? await em.findOne(RefreshToken, {
          where: { tokenHash: sha256(rawRefreshToken), userId: user.id },
          lock: { mode: 'pessimistic_write' },
        })
      : null;
    const live =
      current && !current.revokedAt && current.expiresAt.getTime() > Date.now()
        ? current
        : null;

    await this.revokeAllRefreshTokens(em, user.id);
    const next = await this.issue(em, user, meta, live?.familyId);
    if (live) {
      await em.update(RefreshToken, live.id, {
        replacedBy: next.refreshTokenId,
      });
    }
    return { accessToken: next.accessToken, refreshToken: next.refreshToken };
  }

  private async verifyAccessToken(
    token: string,
  ): Promise<AccessTokenPayload | null> {
    try {
      return await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      return null; // expired or forged → nothing to block
    }
  }
}
