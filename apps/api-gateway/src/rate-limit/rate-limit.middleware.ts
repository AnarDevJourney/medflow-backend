import { Inject, Injectable, Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import Redis from 'ioredis';
import { API_PREFIX, ErrorCode, REDIS_CLIENT } from '@medflow/common';
import { isStrictRateLimitRoute } from '../auth/public-routes';
import { sendError } from '../common/send-error';
import { GatewayConfigService } from '../config/gateway-config.service';

const WINDOW_SECONDS = 60;

// Fixed-window limiter in Redis, shared by every gateway instance (DOC 3.6):
// 10/min per IP on login & forgot-password, 100/min per IP on the rest of
// the API. Express middleware because proxied requests skip Nest guards.
@Injectable()
export class RateLimitMiddleware {
  private readonly logger = new Logger(RateLimitMiddleware.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: GatewayConfigService,
  ) {}

  readonly middleware = (req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith(`/${API_PREFIX}/`)) return next();
    if (req.path.startsWith(`/${API_PREFIX}/health`)) return next();

    void this.check(req, res, next);
  };

  private async check(req: Request, res: Response, next: NextFunction) {
    const strict = isStrictRateLimitRoute(req.method, req.path);
    const limit = strict
      ? this.config.rateLimitStrict
      : this.config.rateLimitDefault;
    // TODO(prod): behind a load balancer use the client IP from
    // x-forwarded-for (app.set('trust proxy', …)) instead of the socket address
    const ip = req.socket.remoteAddress ?? 'unknown';
    const key = `ratelimit:${strict ? 'strict' : 'default'}:${ip}`;

    let count: number;
    let ttl: number;
    try {
      const results = await this.redis
        .multi()
        .incr(key)
        .expire(key, WINDOW_SECONDS, 'NX')
        .ttl(key)
        .exec();
      count = Number(results?.[0]?.[1]);
      ttl = Number(results?.[2]?.[1]);
    } catch (error) {
      // Fail open: a Redis hiccup should not take the whole API down
      this.logger.warn(`Rate limit check skipped: ${(error as Error).message}`);
      return next();
    }

    const retryAfter = ttl > 0 ? ttl : WINDOW_SECONDS;
    res.setHeader('RateLimit-Limit', limit);
    res.setHeader('RateLimit-Remaining', Math.max(0, limit - count));
    res.setHeader('RateLimit-Reset', retryAfter);

    if (count > limit) {
      return sendError(
        req,
        res,
        429,
        ErrorCode.TOO_MANY_REQUESTS,
        `Too many requests, please try again in ${retryAfter} seconds`,
        { 'Retry-After': retryAfter },
      );
    }
    next();
  }
}
