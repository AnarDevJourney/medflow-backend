import {
  PageVisit,
  SidebarGroup,
  SidebarSettings,
} from './entities/sidebar-settings.entity';

export interface SidebarSettingsResponse {
  collapsed: boolean;
  groups: SidebarGroup[] | null;
  favorites: string[];
  showFrequent: boolean;
  showRecent: boolean;
  pageVisits: Record<string, PageVisit>;
  updatedAt: Date | null; // null = nothing saved yet
}

// What a user without a row gets (same as the column defaults)
export const DEFAULT_SIDEBAR_SETTINGS: SidebarSettingsResponse = {
  collapsed: false,
  groups: null,
  favorites: [],
  showFrequent: true,
  showRecent: true,
  pageVisits: {},
  updatedAt: null,
};

export function toSidebarSettingsResponse(
  row: SidebarSettings,
): SidebarSettingsResponse {
  return {
    collapsed: row.collapsed,
    groups: row.groups,
    favorites: row.favorites,
    showFrequent: row.showFrequent,
    showRecent: row.showRecent,
    pageVisits: row.pageVisits,
    updatedAt: row.updatedAt,
  };
}
