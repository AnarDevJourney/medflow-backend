import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppException, ErrorCode } from '@medflow/common';
import { UpdateTableSettingsDto } from './dto/update-table-settings.dto';
import { TableSettings } from './entities/table-settings.entity';
import {
  defaultTableSettings,
  TableSettingsResponse,
  toTableSettingsResponse,
} from './table-settings.response';

// The app has a few dozen tables; stops a misbehaving client from creating
// rows for invented table keys without limit
const MAX_TABLES_PER_USER = 200;

// DTO field → column. Only these can be written by PATCH.
const COLUMNS = {
  columns: { column: 'columns', json: true },
  density: { column: 'density', json: false },
  view: { column: 'view', json: false },
} as const satisfies Record<
  keyof UpdateTableSettingsDto,
  { column: string; json: boolean }
>;

// Each user reads and writes only their own rows (user id from the gateway).
@Injectable()
export class TableSettingsService {
  constructor(
    @InjectRepository(TableSettings)
    private readonly settings: Repository<TableSettings>,
  ) {}

  async get(userId: string, tableKey: string): Promise<TableSettingsResponse> {
    const row = await this.settings.findOneBy({ userId, tableKey });
    return row ? toTableSettingsResponse(row) : defaultTableSettings(tableKey);
  }

  // Upsert of the sent fields only (same pattern as the sidebar settings)
  async update(
    userId: string,
    tableKey: string,
    dto: UpdateTableSettingsDto,
  ): Promise<TableSettingsResponse> {
    if (dto.columns) assertUniqueKeys(dto.columns);

    const fields = (Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]).filter(
      (key) => dto[key] !== undefined,
    );
    if (fields.length === 0) return this.get(userId, tableKey);
    await this.assertRoomForNewTable(userId, tableKey);

    const columns = fields.map((key) => COLUMNS[key].column);
    const params: unknown[] = [userId, tableKey];
    const placeholders = fields.map((key) => {
      const { json } = COLUMNS[key];
      const value = dto[key];
      // null must be SQL NULL ("back to default"), not the JSON value null
      params.push(json && value !== null ? JSON.stringify(value) : value);
      return `$${params.length}${json ? '::jsonb' : ''}`;
    });

    await this.settings.query(
      `INSERT INTO table_settings (user_id, table_key, ${columns.join(', ')})
       VALUES ($1, $2, ${placeholders.join(', ')})
       ON CONFLICT (user_id, table_key) DO UPDATE SET
         ${columns.map((c) => `${c} = EXCLUDED.${c}`).join(', ')},
         updated_at = now()`,
      params,
    );
    return this.get(userId, tableKey);
  }

  // "Reset to default": the row goes, the table uses its defaults again
  async reset(userId: string, tableKey: string): Promise<void> {
    await this.settings.delete({ userId, tableKey });
  }

  private async assertRoomForNewTable(userId: string, tableKey: string) {
    if (await this.settings.existsBy({ userId, tableKey })) return;
    if ((await this.settings.countBy({ userId })) < MAX_TABLES_PER_USER) return;
    throw new AppException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      ErrorCode.BUSINESS_RULE,
      `At most ${MAX_TABLES_PER_USER} tables can have saved settings`,
    );
  }
}

function assertUniqueKeys(columns: { key: string }[]): void {
  const seen = new Set<string>();
  const duplicates = columns
    .map((column) => column.key)
    .filter((key) => seen.has(key) || !seen.add(key));
  if (duplicates.length > 0) {
    throw new AppException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_ERROR,
      'Invalid table columns',
      [
        {
          field: 'columns',
          errors: duplicates.map((key) => `duplicate column "${key}"`),
        },
      ],
    );
  }
}
