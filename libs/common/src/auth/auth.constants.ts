import { API_PREFIX } from '../constants/headers';
import { Role } from '../enums/role.enum';

// Cookie names shared by auth-service (sets them) and the gateway (reads the
// access token on every request). Both are HttpOnly — JS never sees them.
export const AUTH_COOKIES = {
  ACCESS: 'access_token',
  REFRESH: 'refresh_token',
} as const;

// The refresh cookie is only sent to /api/v1/auth/* (refresh, logout)
export const REFRESH_COOKIE_PATH = `/${API_PREFIX}/auth`;

// Claims of the access JWT, signed by auth-service and verified by the gateway
export interface AccessTokenPayload {
  sub: string;
  role: Role;
  name: string;
  email: string;
  jti: string; // unique per token, so a single token can be blocked on logout
  iatMs: number; // issue time in ms — iat has only 1 s precision, too coarse
  // to tell "issued just before" from "issued just after" a revocation
  iat: number; // seconds
  exp: number; // seconds
}

// Redis keys for revoking access tokens before they expire. auth-service
// writes them, the gateway checks them on every authenticated request.
export const AUTH_REDIS_KEYS = {
  // One token (logout). TTL = the token's remaining lifetime.
  blockedToken: (jti: string) => `auth:blocked-jti:${jti}`,
  // Every token of a user issued before this unix time (ms, vs iatMs) is dead:
  // deactivation, password reset, refresh-token reuse. TTL = access TTL.
  revokedBefore: (userId: string) => `auth:revoked-before:${userId}`,
};
