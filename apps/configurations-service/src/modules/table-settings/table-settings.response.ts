import {
  TableColumnSetting,
  TableDensity,
  TableSettings,
} from './entities/table-settings.entity';

export interface TableSettingsResponse {
  tableKey: string;
  columns: TableColumnSetting[] | null; // null = table defaults
  density: TableDensity | null;
  view: string | null;
  updatedAt: Date | null; // null = nothing saved yet
}

export const defaultTableSettings = (
  tableKey: string,
): TableSettingsResponse => ({
  tableKey,
  columns: null,
  density: null,
  view: null,
  updatedAt: null,
});

export function toTableSettingsResponse(
  row: TableSettings,
): TableSettingsResponse {
  return {
    tableKey: row.tableKey,
    columns: row.columns,
    density: row.density,
    view: row.view,
    updatedAt: row.updatedAt,
  };
}
