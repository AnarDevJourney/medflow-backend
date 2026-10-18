import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { NextFunction, Response } from 'express';
import Redis from 'ioredis';
import {
  AccessTokenPayload,
  AUTH_COOKIES,
  ErrorCode,
  isAccessTokenRevoked,
  readCookie,
  REDIS_CLIENT,
} from '@medflow/common';
import { sendError } from '../common/send-error';
import { ProxyService } from '../proxy/proxy.service';
import { AuthenticatedRequest } from './authenticated-request';
import { isPublicRoute } from './public-routes';

// JwtAuthGuard of DOC 1.3 step 4 — an Express middleware because proxied
// requests never reach Nest's router (so Nest guards would not run).
// Only the gateway verifies JWTs; services trust the x-user-* headers.
@Injectable()
export class AuthMiddleware {
  private readonly logger = new Logger(AuthMiddleware.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly proxy: ProxyService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  readonly middleware = (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) => {
    // Gateway's own routes (/api/v1/health, /docs) and the WebSocket
    // handshake (verified by notification-history) are not checked here
    if (!this.proxy.ownsHttpPath(req.path)) return next();
    if (isPublicRoute(req.method, req.path)) return next();

    void this.authenticate(req, res, next);
  };

  private async authenticate(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    const token = readCookie(req.headers.cookie, AUTH_COOKIES.ACCESS);
    if (!token) {
      return sendError(
        req,
        res,
        401,
        ErrorCode.UNAUTHORIZED,
        'Authentication required',
      );
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      return sendError(
        req,
        res,
        401,
        ErrorCode.UNAUTHORIZED,
        'Session expired, please refresh',
      );
    }

    let revoked: boolean;
    try {
      revoked = await isAccessTokenRevoked(this.redis, payload);
    } catch (error) {
      // Fail closed: without the block-list we cannot tell a logged-out token
      this.logger.error(`Block-list check failed: ${(error as Error).message}`);
      return sendError(
        req,
        res,
        503,
        ErrorCode.SERVICE_UNAVAILABLE,
        'Authentication is temporarily unavailable, please try again',
      );
    }

    // Logged-out token, or issued before a deactivation / password reset /
    // refresh-token reuse
    if (revoked) {
      return sendError(
        req,
        res,
        401,
        ErrorCode.UNAUTHORIZED,
        'Session has been revoked, please log in again',
      );
    }

    req.auth = payload;
    next();
  }
}
