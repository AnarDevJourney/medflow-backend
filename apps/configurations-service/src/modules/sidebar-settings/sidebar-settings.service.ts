import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppException, ErrorCode } from '@medflow/common';
import { UpdateSidebarSettingsDto } from './dto/update-sidebar-settings.dto';
import { SidebarSettings } from './entities/sidebar-settings.entity';
import {
  DEFAULT_SIDEBAR_SETTINGS,
  SidebarSettingsResponse,
  toSidebarSettingsResponse,
} from './sidebar-settings.response';

// A user can track at most this many distinct pages (the app has ~15);
// stops a misbehaving client from growing the row without limit
const MAX_TRACKED_PAGES = 100;

// DTO field → column. Only these can be written by PATCH.
const COLUMNS = {
  collapsed: { column: 'collapsed', json: false },
  position: { column: 'position', json: false },
  groups: { column: 'groups', json: true },
  favorites: { column: 'favorites', json: true },
  showFrequent: { column: 'show_frequent', json: false },
  showRecent: { column: 'show_recent', json: false },
} as const satisfies Record<
  keyof UpdateSidebarSettingsDto,
  { column: string; json: boolean }
>;

// Each user reads and writes only their own row (user id from the gateway).
@Injectable()
export class SidebarSettingsService {
  constructor(
    @InjectRepository(SidebarSettings)
    private readonly settings: Repository<SidebarSettings>,
  ) {}

  async get(userId: string): Promise<SidebarSettingsResponse> {
    const row = await this.settings.findOneBy({ userId });
    return row ? toSidebarSettingsResponse(row) : DEFAULT_SIDEBAR_SETTINGS;
  }

  // Upsert of the sent fields only — two tabs changing different settings
  // never overwrite each other.
  async update(
    userId: string,
    dto: UpdateSidebarSettingsDto,
  ): Promise<SidebarSettingsResponse> {
    if (dto.groups) assertValidGroups(dto.groups);

    const fields = (Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]).filter(
      (key) => dto[key] !== undefined,
    );
    if (fields.length === 0) return this.get(userId);

    const columns = fields.map((key) => COLUMNS[key].column);
    const params: unknown[] = [userId];
    const placeholders = fields.map((key) => {
      const { json } = COLUMNS[key];
      const value = dto[key];
      // groups: null must be SQL NULL, not the JSON value null
      params.push(json && value !== null ? JSON.stringify(value) : value);
      return `$${params.length}${json ? '::jsonb' : ''}`;
    });

    await this.settings.query(
      `INSERT INTO sidebar_settings (user_id, ${columns.join(', ')})
       VALUES ($1, ${placeholders.join(', ')})
       ON CONFLICT (user_id) DO UPDATE SET
         ${columns.map((c) => `${c} = EXCLUDED.${c}`).join(', ')},
         updated_at = now()`,
      params,
    );
    return this.get(userId);
  }

  // One atomic statement, so parallel visits from several tabs all count.
  // Visits are usage data, not a settings change: updated_at stays.
  async recordVisit(userId: string, pageKey: string): Promise<void> {
    await this.settings.query(
      `INSERT INTO sidebar_settings (user_id, page_visits)
       VALUES ($1, jsonb_build_object($2::text, jsonb_build_object('count', 1, 'lastVisitedAt', now())))
       ON CONFLICT (user_id) DO UPDATE SET page_visits =
         CASE WHEN sidebar_settings.page_visits ? $2::text
                OR (SELECT count(*) FROM jsonb_object_keys(sidebar_settings.page_visits)) < $3
           THEN jsonb_set(
             sidebar_settings.page_visits,
             ARRAY[$2::text],
             jsonb_build_object(
               'count', COALESCE((sidebar_settings.page_visits -> $2::text ->> 'count')::int, 0) + 1,
               'lastVisitedAt', now()))
           ELSE sidebar_settings.page_visits
         END`,
      [userId, pageKey, MAX_TRACKED_PAGES],
    );
  }

  // "Clear history": empties frequent + recent, keeps the layout
  async clearVisits(userId: string): Promise<void> {
    await this.settings.update({ userId }, { pageVisits: {} });
  }
}

// Group ids unique, and a page in at most one group
function assertValidGroups(groups: { id: string; items: string[] }[]): void {
  const errors: string[] = [];
  const ids = new Set<string>();
  const pages = new Set<string>();
  for (const group of groups) {
    if (ids.has(group.id)) errors.push(`duplicate group id "${group.id}"`);
    ids.add(group.id);
    for (const page of group.items) {
      if (pages.has(page))
        errors.push(`page "${page}" is in more than one group`);
      pages.add(page);
    }
  }
  if (errors.length > 0) {
    throw new AppException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_ERROR,
      'Invalid sidebar groups',
      [{ field: 'groups', errors }],
    );
  }
}
