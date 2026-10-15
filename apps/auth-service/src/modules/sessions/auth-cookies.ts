import type { CookieOptions, Response } from 'express';
import { AUTH_COOKIES, REFRESH_COOKIE_PATH } from '@medflow/common';
import { AuthConfigService } from '../../config/auth-config.service';
import { IssuedTokens } from './sessions.service';

function baseOptions(config: AuthConfigService): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure };
}

export function setAuthCookies(
  res: Response,
  tokens: IssuedTokens,
  config: AuthConfigService,
): void {
  res.cookie(AUTH_COOKIES.ACCESS, tokens.accessToken, {
    ...baseOptions(config),
    path: '/',
    maxAge: config.accessTtlSeconds * 1000,
  });
  res.cookie(AUTH_COOKIES.REFRESH, tokens.refreshToken, {
    ...baseOptions(config),
    path: REFRESH_COOKIE_PATH,
    maxAge: config.refreshTtlSeconds * 1000,
  });
}

export function clearAuthCookies(res: Response, config: AuthConfigService) {
  res.clearCookie(AUTH_COOKIES.ACCESS, { ...baseOptions(config), path: '/' });
  res.clearCookie(AUTH_COOKIES.REFRESH, {
    ...baseOptions(config),
    path: REFRESH_COOKIE_PATH,
  });
}
