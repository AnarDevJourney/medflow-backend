import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, Role, Roles } from '@medflow/common';
import type { CurrentUserData } from '@medflow/common';
import { RecordPageVisitDto } from './dto/record-page-visit.dto';
import { UpdateSidebarSettingsDto } from './dto/update-sidebar-settings.dto';
import { SidebarSettingsService } from './sidebar-settings.service';

// Own sidebar configuration — every role
@ApiTags('sidebar settings')
@Controller('configurations/sidebar')
@Roles(...Object.values(Role))
export class SidebarSettingsController {
  constructor(private readonly sidebar: SidebarSettingsService) {}

  @Get()
  get(@CurrentUser() user: CurrentUserData) {
    return this.sidebar.get(user.id);
  }

  @Patch()
  update(
    @Body() dto: UpdateSidebarSettingsDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.sidebar.update(user.id, dto);
  }

  @Post('visits')
  @HttpCode(HttpStatus.NO_CONTENT)
  recordVisit(
    @Body() dto: RecordPageVisitDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.sidebar.recordVisit(user.id, dto.pageKey);
  }

  @Delete('visits')
  @HttpCode(HttpStatus.NO_CONTENT)
  clearVisits(@CurrentUser() user: CurrentUserData) {
    return this.sidebar.clearVisits(user.id);
  }
}
