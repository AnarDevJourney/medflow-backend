import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

// Page keys and group ids: lowercase slugs ('patients', 'lab-queue', 'g-k3x9')
export const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SLUG_MESSAGE =
  'must be a lowercase slug (a-z, 0-9, -), max 40 characters';

export const MAX_GROUPS = 20;
export const MAX_GROUP_ITEMS = 50;
export const MAX_FAVORITES = 30;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Booleans in the body: implicit conversion would turn "yes" into true,
// so @IsBoolean() checks the value as it was sent
const sent = ({ obj, key }: { obj: Record<string, unknown>; key: string }) =>
  obj[key];

export class SidebarGroupDto {
  @ApiProperty({ example: 'clinical' })
  @Matches(SLUG, { message: `id ${SLUG_MESSAGE}` })
  id: string;

  // null = built-in group with a translated title
  @ApiProperty({ example: 'Daily work', nullable: true, type: String })
  @ValidateIf((_, value) => value !== null)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  name: string | null;

  @ApiProperty()
  @Transform(sent)
  @IsBoolean()
  collapsed: boolean;

  @ApiProperty({ example: ['patients', 'appointments'] })
  @IsArray()
  @ArrayMaxSize(MAX_GROUP_ITEMS)
  @Matches(SLUG, { each: true, message: `each item ${SLUG_MESSAGE}` })
  items: string[];
}

// PATCH /configurations/sidebar — only the sent fields change
export class UpdateSidebarSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(sent)
  @IsBoolean()
  collapsed?: boolean;

  // null = back to the default grouping
  @ApiPropertyOptional({ type: [SidebarGroupDto], nullable: true })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsArray()
  @ArrayMaxSize(MAX_GROUPS)
  @ValidateNested({ each: true })
  @Type(() => SidebarGroupDto)
  groups?: SidebarGroupDto[] | null;

  @ApiPropertyOptional({ example: ['patients'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FAVORITES)
  @ArrayUnique()
  @Matches(SLUG, { each: true, message: `each favorite ${SLUG_MESSAGE}` })
  favorites?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(sent)
  @IsBoolean()
  showFrequent?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(sent)
  @IsBoolean()
  showRecent?: boolean;
}
