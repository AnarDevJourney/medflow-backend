import {
  MotionPreference,
  ThemeMode,
  ThemeSettings,
  UiDensity,
} from './entities/theme-settings.entity';

export interface ThemeSettingsResponse {
  mode: ThemeMode | null;
  palette: string | null;
  primaryColor: string | null;
  sidebarStyle: string | null;
  density: UiDensity | null;
  motion: MotionPreference | null;
  updatedAt: Date | null; // null = nothing saved yet
}

// What a user without a row gets: every setting at its default
export const DEFAULT_THEME_SETTINGS: ThemeSettingsResponse = {
  mode: null,
  palette: null,
  primaryColor: null,
  sidebarStyle: null,
  density: null,
  motion: null,
  updatedAt: null,
};

export function toThemeSettingsResponse(
  row: ThemeSettings,
): ThemeSettingsResponse {
  return {
    mode: row.mode,
    palette: row.palette,
    primaryColor: row.primaryColor,
    sidebarStyle: row.sidebarStyle,
    density: row.density,
    motion: row.motion,
    updatedAt: row.updatedAt,
  };
}
