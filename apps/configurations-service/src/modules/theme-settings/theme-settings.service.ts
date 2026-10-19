import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UpdateThemeSettingsDto } from './dto/update-theme-settings.dto';
import { ThemeSettings } from './entities/theme-settings.entity';
import {
  DEFAULT_THEME_SETTINGS,
  ThemeSettingsResponse,
  toThemeSettingsResponse,
} from './theme-settings.response';

// DTO field → column. Only these can be written by PATCH.
const COLUMNS = {
  mode: 'mode',
  palette: 'palette',
  primaryColor: 'primary_color',
  sidebarStyle: 'sidebar_style',
  density: 'density',
  motion: 'motion',
} as const satisfies Record<keyof UpdateThemeSettingsDto, string>;

// Each user reads and writes only their own row (user id from the gateway).
@Injectable()
export class ThemeSettingsService {
  constructor(
    @InjectRepository(ThemeSettings)
    private readonly settings: Repository<ThemeSettings>,
  ) {}

  async get(userId: string): Promise<ThemeSettingsResponse> {
    const row = await this.settings.findOneBy({ userId });
    return row ? toThemeSettingsResponse(row) : DEFAULT_THEME_SETTINGS;
  }

  // Upsert of the sent fields only (same pattern as sidebar / table settings)
  async update(
    userId: string,
    dto: UpdateThemeSettingsDto,
  ): Promise<ThemeSettingsResponse> {
    const fields = (Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]).filter(
      (key) => dto[key] !== undefined,
    );
    if (fields.length === 0) return this.get(userId);

    const columns = fields.map((key) => COLUMNS[key]);
    const params: unknown[] = [userId, ...fields.map((key) => dto[key])];
    await this.settings.query(
      `INSERT INTO theme_settings (user_id, ${columns.join(', ')})
       VALUES ($1, ${columns.map((_, i) => `$${i + 2}`).join(', ')})
       ON CONFLICT (user_id) DO UPDATE SET
         ${columns.map((c) => `${c} = EXCLUDED.${c}`).join(', ')},
         updated_at = now()`,
      params,
    );
    return this.get(userId);
  }

  // "Reset to default": the row goes, every setting is the default again
  async reset(userId: string): Promise<void> {
    await this.settings.delete({ userId });
  }
}
