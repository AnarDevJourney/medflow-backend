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
import { CreatePatientDto } from './dto/create-patient.dto';
import { ListPatientsQueryDto } from './dto/list-patients-query.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { PatientStatsService } from './patient-stats.service';
import { PatientsService } from './patients.service';

// DOC 8.4. PATCH /patients/:id/reactivate is our addition: a record
// deactivated by mistake can come back.
@ApiTags('patients')
@Controller('patients')
export class PatientsController {
  constructor(
    private readonly patients: PatientsService,
    private readonly statsService: PatientStatsService,
  ) {}

  @Get()
  @RequirePermission('patients.read')
  list(@Query() query: ListPatientsQueryDto) {
    return this.patients.list(query);
  }

  @Post()
  @RequirePermission('patients.create')
  create(@Body() dto: CreatePatientDto, @CurrentUser() actor: CurrentUserData) {
    return this.patients.create(dto, actor);
  }

  // Before :id, so 'stats' is not taken for a patient id
  @Get('stats')
  @RequirePermission('patients.stats')
  stats() {
    return this.statsService.stats();
  }

  // Allergies and conditions are included only for clinical readers
  @Get(':id')
  @RequirePermission('patients.read')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() viewer: CurrentUserData,
  ) {
    return this.patients.findOne(id, viewer);
  }

  @Patch(':id')
  @RequirePermission('patients.update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePatientDto,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.patients.update(id, dto, actor);
  }

  @Patch(':id/deactivate')
  @RequirePermission('patients.deactivate')
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.patients.setActive(id, false, actor);
  }

  @Patch(':id/reactivate')
  @RequirePermission('patients.deactivate')
  reactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.patients.setActive(id, true, actor);
  }
}
