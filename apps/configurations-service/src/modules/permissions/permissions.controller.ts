import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Put,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  Authenticated,
  CurrentUser,
  readPermissionsHeader,
  RequirePermission,
  Role,
} from '@medflow/common';
import type { CurrentUserData } from '@medflow/common';
import { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto';
import { PermissionsService } from './permissions.service';

@ApiTags('permissions')
@Controller('configurations/permissions')
export class PermissionsController {
  constructor(private readonly permissions: PermissionsService) {}

  // The caller's own permissions — exactly what the gateway sent (Redis),
  // no lookup at all
  @Get('me')
  @Authenticated()
  me(@CurrentUser() user: CurrentUserData, @Req() req: Request) {
    return { role: user.role, permissions: readPermissionsHeader(req) };
  }

  @Get()
  @RequirePermission('permissions.read')
  matrix() {
    return this.permissions.getMatrix();
  }

  // Full list per sent role; roles not in the body stay unchanged
  @Put()
  @RequirePermission('permissions.manage')
  update(
    @Body() dto: UpdateRolePermissionsDto,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.permissions.update(dto.roles, actor);
  }
}

// Called by the gateway when a role's Redis key is missing
@ApiTags('permissions')
@Controller('internal/permissions')
export class InternalPermissionsController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get('roles/:role')
  async forRole(@Param('role', new ParseEnumPipe(Role)) role: Role) {
    return { role, permissions: await this.permissions.getRoleFromDb(role) };
  }
}
