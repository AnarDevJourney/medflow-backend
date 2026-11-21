import {
  Body,
  Controller,
  Delete,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@medflow/common';
import type { CurrentUserData } from '@medflow/common';
import { AddDiagnosisDto, UpdateDiagnosisDto } from './dto/diagnosis.dto';
import { RecordVitalsDto } from './dto/vitals.dto';
import { DiagnosesService } from './diagnoses.service';
import { VitalsService } from './vitals.service';

// DOC 8.6 — vitals and diagnoses of a visit. Every write answers with the
// whole visit (GET /encounters/:id shape).
@ApiTags('encounters')
@Controller('encounters/:id')
export class ClinicalController {
  constructor(
    private readonly vitals: VitalsService,
    private readonly diagnoses: DiagnosesService,
  ) {}

  // The visit's doctor or a nurse
  @Post('vitals')
  @RequirePermission('vitals.record')
  recordVitals(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordVitalsDto,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.vitals.record(id, dto, actor);
  }

  @Post('diagnoses')
  @RequirePermission('diagnoses.manage')
  addDiagnosis(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddDiagnosisDto,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.diagnoses.add(id, dto, actor);
  }

  @Patch('diagnoses/:dxId')
  @RequirePermission('diagnoses.manage')
  updateDiagnosis(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('dxId', ParseUUIDPipe) dxId: string,
    @Body() dto: UpdateDiagnosisDto,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.diagnoses.update(id, dxId, dto, actor);
  }

  @Delete('diagnoses/:dxId')
  @RequirePermission('diagnoses.manage')
  removeDiagnosis(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('dxId', ParseUUIDPipe) dxId: string,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.diagnoses.remove(id, dxId, actor);
  }
}
