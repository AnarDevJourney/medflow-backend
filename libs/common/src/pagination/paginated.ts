import { PaginationQueryDto } from './pagination-query.dto';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
}

export interface Paginated<T> {
  items: T[];
  meta: PaginationMeta;
}

export function paginated<T>(
  items: T[],
  total: number,
  query: PaginationQueryDto,
): Paginated<T> {
  return { items, meta: { page: query.page, limit: query.limit, total } };
}

export function skipOf(query: PaginationQueryDto): number {
  return (query.page - 1) * query.limit;
}

// Turns "createdAt:desc" into { createdAt: 'DESC' }, accepting only
// whitelisted fields so clients cannot sort by arbitrary columns.
export function parseSort<F extends string>(
  sort: string | undefined,
  allowed: readonly F[],
  fallback: Partial<Record<F, 'ASC' | 'DESC'>>,
): Partial<Record<F, 'ASC' | 'DESC'>> {
  if (!sort) return fallback;
  const [field, direction] = sort.split(':') as [F, string];
  if (!allowed.includes(field)) return fallback;
  return { [field]: direction === 'asc' ? 'ASC' : 'DESC' } as Partial<
    Record<F, 'ASC' | 'DESC'>
  >;
}
