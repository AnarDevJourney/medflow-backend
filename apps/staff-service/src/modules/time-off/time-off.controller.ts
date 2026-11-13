import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  RequireAnyPermission,
  RequirePermission,
} from '@medflow/common';
import type { CurrentUserData } from '@medflow/common';
import { CreateTimeOffDto } from './dto/create-time-off.dto';
import { ListTimeOffQueryDto } from './dto/list-time-off-query.dto';
import { TimeOffService } from './time-off.service';

// DOC 8.3
@ApiTags('time-off')
@Controller('time-off')
export class TimeOffController {
  constructor(private readonly timeOff: TimeOffService) {}

  @Get()
  @RequireAnyPermission('schedules.read', 'schedules.read_own')
  list(
    @Query() query: ListTimeOffQueryDto,
    @CurrentUser() viewer: CurrentUserData,
  ) {
    return this.timeOff.list(query, viewer);
  }

  @Post()
  @RequirePermission('schedules.manage')
  create(@Body() dto: CreateTimeOffDto, @CurrentUser() actor: CurrentUserData) {
    return this.timeOff.create(dto, actor);
  }

  @Delete(':id')
  @RequirePermission('schedules.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.timeOff.remove(id, actor);
  }
}
