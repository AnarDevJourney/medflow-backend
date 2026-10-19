import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { SLUG } from '../../sidebar-settings/dto/update-sidebar-settings.dto';
import {
  COLUMN_PINS,
  TABLE_DENSITIES,
} from '../entities/table-settings.entity';
import type {
  ColumnPin,
  TableDensity,
} from '../entities/table-settings.entity';

// Column keys follow the API's field names ('lastName', 'createdAt', 'mrn')
export const COLUMN_KEY = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,59}$/;

export const MAX_COLUMNS = 60;
export const MIN_COLUMN_WIDTH = 40;
export const MAX_COLUMN_WIDTH = 1200;

// Booleans in the body: implicit conversion would turn "yes" into true
const sent = ({ obj, key }: { obj: Record<string, unknown>; key: string }) =>
  obj[key];

export class TableColumnSettingDto {
  @ApiProperty({ example: 'lastName' })
  @Matches(COLUMN_KEY, {
    message: 'key must be letters, digits, _ . - (max 60 characters)',
  })
  key: string;

  @ApiProperty()
  @Transform(sent)
  @IsBoolean()
  visible: boolean;

  @ApiProperty({ nullable: true, type: Number, example: 180 })
  @ValidateIf((_, value) => value !== null)
  @Transform(sent)
  @IsInt()
  @Min(MIN_COLUMN_WIDTH)
  @Max(MAX_COLUMN_WIDTH)
  width: number | null;

  @ApiProperty({ enum: COLUMN_PINS, nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsIn(COLUMN_PINS)
  pinned: ColumnPin | null;
}

// PATCH /configurations/tables/:tableKey — only the sent fields change;
// null sets a field back to the table's default
export class UpdateTableSettingsDto {
  @ApiPropertyOptional({ type: [TableColumnSettingDto], nullable: true })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsArray()
  @ArrayMaxSize(MAX_COLUMNS)
  @ValidateNested({ each: true })
  @Type(() => TableColumnSettingDto)
  columns?: TableColumnSettingDto[] | null;

  @ApiPropertyOptional({ enum: TABLE_DENSITIES, nullable: true })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsIn(TABLE_DENSITIES)
  density?: TableDensity | null;

  @ApiPropertyOptional({ example: 'striped', nullable: true, type: String })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @Matches(SLUG, {
    message: 'view must be a lowercase slug (a-z, 0-9, -), max 40 characters',
  })
  view?: string | null;
}
