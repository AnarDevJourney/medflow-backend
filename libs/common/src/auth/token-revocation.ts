import type Redis from 'ioredis';
import { AccessTokenPayload, AUTH_REDIS_KEYS } from './auth.constants';

// True for a logged-out token, or one issued before a deactivation /
// password reset / refresh-token reuse (compared in ms; a missing iatMs
// counts as revoked). Throws when Redis is unreachable — callers fail
// closed. Used by the gateway (every request) and the Socket.io handshake.
export async function isAccessTokenRevoked(
  redis: Redis,
  payload: AccessTokenPayload,
): Promise<boolean> {
  const [blocked, revokedBefore] = await redis.mget(
    AUTH_REDIS_KEYS.blockedToken(payload.jti),
    AUTH_REDIS_KEYS.revokedBefore(payload.sub),
  );
  return (
    blocked !== null ||
    (revokedBefore !== null && !(payload.iatMs >= Number(revokedBefore)))
  );
}
