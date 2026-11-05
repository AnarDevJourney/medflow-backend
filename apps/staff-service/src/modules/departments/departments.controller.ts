import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@medflow/common';
import type { CurrentUserData } from '@medflow/common';
import { DepartmentsService } from './departments.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { ListDepartmentsQueryDto } from './dto/list-departments-query.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

// DOC 8.3. GET /departments/all is our addition: the management page also
// needs inactive departments, with search and pages.
@ApiTags('departments')
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get()
  @RequirePermission('departments.read')
  listActive() {
    return this.departments.listActive();
  }

  @Get('all')
  @RequirePermission('departments.manage')
  list(@Query() query: ListDepartmentsQueryDto) {
    return this.departments.list(query);
  }

  @Post()
  @RequirePermission('departments.manage')
  create(
    @Body() dto: CreateDepartmentDto,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.departments.create(dto, actor);
  }

  @Patch(':id')
  @RequirePermission('departments.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDepartmentDto,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.departments.update(id, dto, actor);
  }
}
