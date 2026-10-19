import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, Role, Roles } from '@medflow/common';
import type { CurrentUserData } from '@medflow/common';
import { TableKeyParam } from './dto/table-key.param';
import { UpdateTableSettingsDto } from './dto/update-table-settings.dto';
import { TableSettingsService } from './table-settings.service';

// Own settings of one table — every role
@ApiTags('table settings')
@Controller('configurations/tables')
@Roles(...Object.values(Role))
export class TableSettingsController {
  constructor(private readonly tables: TableSettingsService) {}

  @Get(':tableKey')
  get(
    @Param() { tableKey }: TableKeyParam,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.tables.get(user.id, tableKey);
  }

  @Patch(':tableKey')
  update(
    @Param() { tableKey }: TableKeyParam,
    @Body() dto: UpdateTableSettingsDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.tables.update(user.id, tableKey, dto);
  }

  @Delete(':tableKey')
  @HttpCode(HttpStatus.NO_CONTENT)
  reset(
    @Param() { tableKey }: TableKeyParam,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.tables.reset(user.id, tableKey);
  }
}
