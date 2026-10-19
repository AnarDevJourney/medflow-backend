import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export const THEME_MODES = ['system', 'light', 'dark'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const UI_DENSITIES = ['compact', 'comfortable', 'spacious'] as const;
export type UiDensity = (typeof UI_DENSITIES)[number];

export const MOTION_PREFERENCES = ['system', 'reduced', 'full'] as const;
export type MotionPreference = (typeof MOTION_PREFERENCES)[number];

// Appearance of the app for one user. Palette and sidebar style ids are
// defined by the frontend (only their shape is checked); NULL = default.
@Entity('theme_settings')
export class ThemeSettings {
  @PrimaryColumn('uuid')
  userId: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  mode: ThemeMode | null;

  // Surface color family ('default', 'slate', 'warm', …)
  @Column({ type: 'varchar', length: 40, nullable: true })
  palette: string | null;

  // Accent color, lowercase '#rrggbb'
  @Column({ type: 'varchar', length: 7, nullable: true })
  primaryColor: string | null;

  // 'default', 'tinted', 'dark', 'accent', …
  @Column({ type: 'varchar', length: 40, nullable: true })
  sidebarStyle: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  density: UiDensity | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  motion: MotionPreference | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
