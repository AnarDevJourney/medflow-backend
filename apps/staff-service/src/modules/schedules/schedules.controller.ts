import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  RequireAnyPermission,
  RequirePermission,
} from '@medflow/common';
import type { CurrentUserData } from '@medflow/common';
import { ReplaceScheduleDto } from './dto/replace-schedule.dto';
import { SchedulesService } from './schedules.service';

// DOC 8.3. The body of PUT is { days: [...] } (an object, so it can grow).
@ApiTags('schedules')
@Controller('schedules')
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @Get(':userId')
  @RequireAnyPermission('schedules.read', 'schedules.read_own')
  findOne(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() viewer: CurrentUserData,
  ) {
    return this.schedules.findOne(userId, viewer);
  }

  @Put(':userId')
  @RequirePermission('schedules.manage')
  replace(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: ReplaceScheduleDto,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.schedules.replace(userId, dto, actor);
  }
}
