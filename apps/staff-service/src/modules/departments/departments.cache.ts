import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '@medflow/common';
import type { DepartmentResponse } from './department.mapper';

const KEY = 'staff:departments:active';
const TTL_SECONDS = 600; // DOC 8.3

// Active departments for pickers. The database stays the source of truth:
// a Redis failure only costs a query, it never fails a request.
@Injectable()
export class DepartmentsCache {
  private readonly logger = new Logger(DepartmentsCache.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async get(): Promise<DepartmentResponse[] | null> {
    try {
      const value = await this.redis.get(KEY);
      return value ? (JSON.parse(value) as DepartmentResponse[]) : null;
    } catch (error) {
      this.warn('read', error);
      return null;
    }
  }

  async set(departments: DepartmentResponse[]): Promise<void> {
    try {
      await this.redis.set(KEY, JSON.stringify(departments), 'EX', TTL_SECONDS);
    } catch (error) {
      this.warn('write', error);
    }
  }

  // After a change. If this fails the old list lives until the TTL ends.
  async clear(): Promise<void> {
    try {
      await this.redis.del(KEY);
    } catch (error) {
      this.warn('clear', error);
    }
  }

  private warn(action: string, error: unknown) {
    this.logger.warn(
      `Department cache ${action} failed: ${(error as Error).message}`,
    );
  }
}
