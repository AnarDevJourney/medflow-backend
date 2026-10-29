import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import {
  isPermission,
  Permission,
  permissionsCacheKey,
  REDIS_CLIENT,
  Role,
} from '@medflow/common';

// Writes only if the new state is not older than the cached one. The cache
// is written from two places — the DB (on start / cache miss) and Kafka
// events — and a replayed old event must never overwrite a newer list.
const SET_IF_NEWER = `
local current = tonumber(redis.call('GET', KEYS[2]) or '0')
if tonumber(ARGV[2]) < current then return 0 end
redis.call('SET', KEYS[1], ARGV[1])
redis.call('SET', KEYS[2], ARGV[2])
return 1
`;

const versionKey = (role: Role) => `${permissionsCacheKey(role)}:version`;

// Redis cache of every role's permissions: permissions:role:<ROLE> =
// "users.read,history.read" ('' = none). The gateway reads it on every
// request and forwards it as x-user-permissions. No TTL — the list changes
// only through configurations-service, which rewrites it.
@Injectable()
export class PermissionsCache {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  // version = epoch ms of the state (event occurredAt, or the moment the
  // DB was read). Returns false when a newer state is already cached.
  async set(
    role: Role,
    permissions: readonly string[],
    version: number,
  ): Promise<boolean> {
    const written = await this.redis.eval(
      SET_IF_NEWER,
      2,
      permissionsCacheKey(role),
      versionKey(role),
      permissions.join(','),
      version,
    );
    return written === 1;
  }

  // null for a role that is not cached (Redis was flushed)
  async getMany(roles: Role[]): Promise<Map<Role, Permission[] | null>> {
    const values = await this.redis.mget(roles.map(permissionsCacheKey));
    return new Map(
      roles.map((role, i) => {
        const value = values[i];
        return [
          role,
          value === null
            ? null
            : value === ''
              ? []
              : value.split(',').filter(isPermission),
        ];
      }),
    );
  }
}
