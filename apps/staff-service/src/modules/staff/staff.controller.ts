import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Authenticated, CurrentUser, RequirePermission } from '@medflow/common';
import type { CurrentUserData } from '@medflow/common';
import {
  ListDoctorsQueryDto,
  ListStaffQueryDto,
} from './dto/list-staff-query.dto';
import { UpdateOwnStaffDto, UpdateStaffDto } from './dto/update-staff.dto';
import { StaffService } from './staff.service';

// DOC 8.3. GET /staff/me is our addition (the profile page). The static
// routes come before /:userId.
@ApiTags('staff')
@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @RequirePermission('staff.read')
  list(
    @Query() query: ListStaffQueryDto,
    @CurrentUser() viewer: CurrentUserData,
  ) {
    return this.staff.list(query, viewer);
  }

  @Get('doctors')
  @RequirePermission('staff.read')
  doctors(@Query() query: ListDoctorsQueryDto) {
    return this.staff.doctors(query);
  }

  @Get('me')
  @Authenticated()
  me(@CurrentUser() viewer: CurrentUserData) {
    return this.staff.findOne(viewer.id);
  }

  @Patch('me')
  @Authenticated()
  updateMe(
    @Body() dto: UpdateOwnStaffDto,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.staff.updateOwn(dto, actor);
  }

  @Get(':userId')
  @RequirePermission('staff.read')
  findOne(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.staff.findOne(userId);
  }

  @Patch(':userId')
  @RequirePermission('staff.update')
  update(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateStaffDto,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.staff.update(userId, dto, actor);
  }
}
