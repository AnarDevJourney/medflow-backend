import {
  HttpStatus,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  ALL_PERMISSIONS,
  AppException,
  ErrorCode,
  isPermission,
  LOCKED_ADMIN_PERMISSIONS,
  Permission,
  PERMISSION_GROUPS,
  PERMISSIONS,
  Role,
} from '@medflow/common';
import type { CurrentUserData } from '@medflow/common';
import { ConfigurationsEvents, roleAggregateId } from '@medflow/contracts';
import { OutboxService } from '@medflow/kafka';
import { PermissionsCache } from './permissions.cache';
import {
  PermissionsMatrixResponse,
  RolePermissions,
} from './permissions.response';

const ROLES = Object.values(Role);
const isRole = (value: string): value is Role =>
  (ROLES as string[]).includes(value);

// Catalog order, so lists in Redis, events and responses are stable
const CATALOG_INDEX = new Map(ALL_PERMISSIONS.map((p, i) => [p, i]));
const byCatalog = (a: Permission, b: Permission) =>
  CATALOG_INDEX.get(a)! - CATALOG_INDEX.get(b)!;

// Serializes every reader/writer of role_permissions that touches the
// cache, so a DB read and an event can never put an older list in Redis
// with a newer version (see PermissionsCache.set)
const LOCK_SQL = `SELECT pg_advisory_xact_lock(hashtext('medflow.role_permissions'))`;

// Which role has which permission. The database is read only on start
// (catalog sync + cache warm-up), on a cache miss and when the admin saves;
// everything else is served from Redis.
@Injectable()
export class PermissionsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PermissionsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly cache: PermissionsCache,
    private readonly outbox: OutboxService,
  ) {}

  async onApplicationBootstrap() {
    await this.syncCatalog();
    try {
      await this.refreshCache(ROLES);
    } catch (error) {
      // The gateway refills a missing role through /internal on demand
      this.logger.error(
        `Permission cache warm-up failed: ${(error as Error).message}`,
      );
    }
  }

  // Matrix for the permissions page — from Redis, missing roles from the DB
  async getMatrix(): Promise<PermissionsMatrixResponse> {
    const cached = await this.cache.getMany(ROLES);
    const missing = ROLES.filter((role) => cached.get(role) === null);
    const loaded = missing.length > 0 ? await this.refreshCache(missing) : null;

    const roles = Object.fromEntries(
      ROLES.map((role) => [role, cached.get(role) ?? loaded!.get(role)!]),
    ) as RolePermissions;

    return {
      groups: [...PERMISSION_GROUPS],
      permissions: ALL_PERMISSIONS.map((code) => ({
        code,
        group: PERMISSIONS[code].group,
      })),
      locked: { [Role.ADMIN]: [...LOCKED_ADMIN_PERMISSIONS] },
      roles,
    };
  }

  // Cache miss in the gateway: read the role from the DB and cache it
  async getRoleFromDb(role: Role): Promise<Permission[]> {
    const loaded = await this.refreshCache([role]);
    return loaded.get(role)!;
  }

  // Replaces the permissions of the sent roles. One role_permissions.updated
  // event per changed role, in the same transaction; configurations-service
  // itself consumes it and rewrites the role's Redis key.
  async update(
    body: Record<string, unknown>,
    actor: CurrentUserData,
  ): Promise<Partial<RolePermissions>> {
    const next = parseRoles(body);

    return this.dataSource.transaction(async (em) => {
      await em.query(LOCK_SQL);
      const roles = [...next.keys()];
      const current = await this.load(em, roles);
      const result: Partial<RolePermissions> = {};

      for (const role of roles) {
        const wanted = next.get(role)!;
        const before = new Set(current.get(role));
        const added = wanted.filter((p) => !before.has(p));
        const removed = [...before].filter((p) => !wanted.includes(p));
        result[role] = wanted;
        if (added.length === 0 && removed.length === 0) continue;

        if (removed.length > 0) {
          await em.query(
            `DELETE FROM role_permissions WHERE role = $1 AND permission = ANY($2)`,
            [role, removed],
          );
        }
        if (added.length > 0) {
          await em.query(
            `INSERT INTO role_permissions (role, permission, granted_by)
             SELECT $1, unnest($2::varchar[]), $3`,
            [role, added, actor.id],
          );
        }
        await this.outbox.add(em, {
          eventType: ConfigurationsEvents.ROLE_PERMISSIONS_UPDATED,
          aggregateType: 'ROLE',
          aggregateId: roleAggregateId(role),
          actor,
          payload: { role, permissions: wanted, added, removed },
        });
      }
      return result;
    });
  }

  // Kafka consumer: the event carries the role's full list
  applyEvent(role: string, permissions: string[], occurredAt: string) {
    if (!isRole(role)) return Promise.resolve(false);
    return this.cache.set(
      role,
      permissions.filter(isPermission).sort(byCatalog),
      Date.parse(occurredAt),
    );
  }

  // DB → Redis for the given roles, under the lock (version = read time)
  private refreshCache(roles: Role[]): Promise<Map<Role, Permission[]>> {
    return this.dataSource.transaction(async (em) => {
      await em.query(LOCK_SQL);
      const version = Date.now();
      const loaded = await this.load(em, roles);
      for (const role of roles) {
        await this.cache.set(role, loaded.get(role)!, version);
      }
      return loaded;
    });
  }

  private async load(
    em: EntityManager,
    roles: Role[],
  ): Promise<Map<Role, Permission[]>> {
    const rows = await em.query<{ role: Role; permission: string }[]>(
      `SELECT role, permission FROM role_permissions WHERE role = ANY($1)`,
      [roles],
    );
    const result = new Map<Role, Permission[]>(roles.map((r) => [r, []]));
    for (const row of rows) {
      if (isPermission(row.permission)) {
        result.get(row.role)!.push(row.permission);
      }
    }
    for (const list of result.values()) list.sort(byCatalog);
    return result;
  }

  // Catalog (code) → permissions table. A code seen for the first time gets
  // its default roles once; later the admin's choices are never overridden.
  // Codes removed from the catalog are deleted with their grants.
  private syncCatalog(): Promise<void> {
    return this.dataSource.transaction(async (em) => {
      await em.query(LOCK_SQL);
      const rows = await em.query<{ code: string }[]>(
        `SELECT code FROM permissions`,
      );
      const known = new Set(rows.map((r) => r.code));
      const added = ALL_PERMISSIONS.filter((p) => !known.has(p));
      const obsolete = [...known].filter((code) => !isPermission(code));

      if (added.length > 0) {
        await em.query(
          `INSERT INTO permissions (code) SELECT unnest($1::varchar[])`,
          [added],
        );
        const grants = added.flatMap((p) =>
          PERMISSIONS[p].defaultRoles.map((role) => [role, p] as const),
        );
        await em.query(
          `INSERT INTO role_permissions (role, permission)
           SELECT * FROM unnest($1::varchar[], $2::varchar[])
           ON CONFLICT DO NOTHING`,
          [grants.map((g) => g[0]), grants.map((g) => g[1])],
        );
        this.logger.log(`${added.length} new permission(s) seeded`);
      }
      if (obsolete.length > 0) {
        await em.query(`DELETE FROM permissions WHERE code = ANY($1)`, [
          obsolete,
        ]);
        this.logger.log(`Removed obsolete permissions: ${obsolete.join(', ')}`);
      }
      // ADMIN can never lose the permissions page
      await em.query(
        `INSERT INTO role_permissions (role, permission)
         SELECT 'ADMIN', unnest($1::varchar[])
         ON CONFLICT DO NOTHING`,
        [LOCKED_ADMIN_PERMISSIONS],
      );
    });
  }
}

// { roles: { DOCTOR: ['users.read', …], … } } → validated map
function parseRoles(body: Record<string, unknown>): Map<Role, Permission[]> {
  const errors: { field: string; errors: string[] }[] = [];
  const result = new Map<Role, Permission[]>();

  const entries = Object.entries(body);
  if (entries.length === 0) {
    errors.push({ field: 'roles', errors: ['roles must not be empty'] });
  }
  for (const [role, value] of entries) {
    const field = `roles.${role}`;
    if (!isRole(role)) {
      errors.push({ field, errors: [`${role} is not a role`] });
      continue;
    }
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
      errors.push({ field, errors: [`${field} must be an array of strings`] });
      continue;
    }
    const codes = value as string[];
    const unknown = codes.filter((code) => !isPermission(code));
    if (unknown.length > 0) {
      errors.push({
        field,
        errors: [`Unknown permission(s): ${unknown.join(', ')}`],
      });
      continue;
    }
    result.set(role, [...new Set(codes as Permission[])].sort(byCatalog));
  }

  if (errors.length > 0) {
    throw new AppException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_ERROR,
      'Invalid role permissions',
      errors,
    );
  }

  const admin = result.get(Role.ADMIN);
  const lost = admin
    ? LOCKED_ADMIN_PERMISSIONS.filter((p) => !admin.includes(p))
    : [];
  if (lost.length > 0) {
    throw new AppException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      ErrorCode.BUSINESS_RULE,
      `ADMIN must keep ${lost.join(' and ')}`,
      [
        {
          field: 'roles.ADMIN',
          errors: [`ADMIN must keep ${lost.join(', ')}`],
        },
      ],
    );
  }
  return result;
}
