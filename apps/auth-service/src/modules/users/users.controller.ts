import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@medflow/common';
import type { CurrentUserData } from '@medflow/common';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

// User management (DOC 8.2) — ADMIN by default
@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermission('users.read')
  list(@Query() query: ListUsersQueryDto) {
    return this.users.list(query);
  }

  @Get(':id')
  @RequirePermission('users.read')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.findOne(id);
  }

  @Patch(':id')
  @RequirePermission('users.update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.users.update(id, dto, actor);
  }

  @Post()
  @RequirePermission('users.invite')
  invite(@Body() dto: CreateUserDto, @CurrentUser() actor: CurrentUserData) {
    return this.users.invite(dto, actor);
  }

  @Post(':id/resend-invite')
  @RequirePermission('users.invite')
  @HttpCode(HttpStatus.OK)
  resendInvite(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.users.resendInvite(id, actor);
  }

  @Patch(':id/deactivate')
  @RequirePermission('users.deactivate')
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.users.deactivate(id, actor);
  }

  @Patch(':id/reactivate')
  @RequirePermission('users.deactivate')
  reactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.users.reactivate(id, actor);
  }
}
