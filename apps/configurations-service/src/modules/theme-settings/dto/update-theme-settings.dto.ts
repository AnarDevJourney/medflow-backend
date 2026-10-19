import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, Matches, ValidateIf } from 'class-validator';
import { SLUG } from '../../sidebar-settings/dto/update-sidebar-settings.dto';
import {
  MOTION_PREFERENCES,
  THEME_MODES,
  UI_DENSITIES,
} from '../entities/theme-settings.entity';
import type {
  MotionPreference,
  ThemeMode,
  UiDensity,
} from '../entities/theme-settings.entity';

const SLUG_MESSAGE =
  'must be a lowercase slug (a-z, 0-9, -), max 40 characters';
const sent = (field: unknown) => field !== undefined && field !== null;

// PATCH /configurations/theme — only the sent fields change; null sets a
// field back to the default
export class UpdateThemeSettingsDto {
  @ApiPropertyOptional({ enum: THEME_MODES, nullable: true })
  @ValidateIf((_, value) => sent(value))
  @IsIn(THEME_MODES)
  mode?: ThemeMode | null;

  @ApiPropertyOptional({ example: 'slate', nullable: true, type: String })
  @ValidateIf((_, value) => sent(value))
  @Matches(SLUG, { message: `palette ${SLUG_MESSAGE}` })
  palette?: string | null;

  // Stored lowercase so the same color is always the same string
  @ApiPropertyOptional({ example: '#0f766e', nullable: true, type: String })
  @ValidateIf((_, value) => sent(value))
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @Matches(/^#[0-9a-f]{6}$/, {
    message: 'primaryColor must be a #rrggbb color',
  })
  primaryColor?: string | null;

  @ApiPropertyOptional({ example: 'tinted', nullable: true, type: String })
  @ValidateIf((_, value) => sent(value))
  @Matches(SLUG, { message: `sidebarStyle ${SLUG_MESSAGE}` })
  sidebarStyle?: string | null;

  @ApiPropertyOptional({ enum: UI_DENSITIES, nullable: true })
  @ValidateIf((_, value) => sent(value))
  @IsIn(UI_DENSITIES)
  density?: UiDensity | null;

  @ApiPropertyOptional({ enum: MOTION_PREFERENCES, nullable: true })
  @ValidateIf((_, value) => sent(value))
  @IsIn(MOTION_PREFERENCES)
  motion?: MotionPreference | null;
}
