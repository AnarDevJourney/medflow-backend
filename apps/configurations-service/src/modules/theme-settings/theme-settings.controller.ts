import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, Role, Roles } from '@medflow/common';
import type { CurrentUserData } from '@medflow/common';
import { UpdateThemeSettingsDto } from './dto/update-theme-settings.dto';
import { ThemeSettingsService } from './theme-settings.service';

// Own appearance settings — every role
@ApiTags('theme settings')
@Controller('configurations/theme')
@Roles(...Object.values(Role))
export class ThemeSettingsController {
  constructor(private readonly theme: ThemeSettingsService) {}

  @Get()
  get(@CurrentUser() user: CurrentUserData) {
    return this.theme.get(user.id);
  }

  @Patch()
  update(
    @Body() dto: UpdateThemeSettingsDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.theme.update(user.id, dto);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  reset(@CurrentUser() user: CurrentUserData) {
    return this.theme.reset(user.id);
  }
}
