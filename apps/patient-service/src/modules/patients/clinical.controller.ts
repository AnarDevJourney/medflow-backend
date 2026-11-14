import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@medflow/common';
import type { CurrentUserData } from '@medflow/common';
import { ClinicalService } from './clinical.service';
import {
  CreateAllergyDto,
  CreateConditionDto,
  UpdateAllergyDto,
  UpdateConditionDto,
} from './dto/clinical.dto';

// DOC 8.4 — clinical summary (DOCTOR, NURSE by default). Our additions:
// PATCH of an allergy (severity / reaction change over time) and DELETE of
// a condition (entered by mistake).
@ApiTags('patients')
@Controller('patients/:id')
export class ClinicalController {
  constructor(private readonly clinical: ClinicalService) {}

  @Get('allergies')
  @RequirePermission('patients.clinical_read')
  listAllergies(@Param('id', ParseUUIDPipe) id: string) {
    return this.clinical.listAllergies(id);
  }

  @Post('allergies')
  @RequirePermission('patients.clinical_manage')
  addAllergy(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateAllergyDto,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.clinical.addAllergy(id, dto, actor);
  }

  @Patch('allergies/:allergyId')
  @RequirePermission('patients.clinical_manage')
  updateAllergy(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('allergyId', ParseUUIDPipe) allergyId: string,
    @Body() dto: UpdateAllergyDto,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.clinical.updateAllergy(id, allergyId, dto, actor);
  }

  @Delete('allergies/:allergyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('patients.clinical_manage')
  removeAllergy(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('allergyId', ParseUUIDPipe) allergyId: string,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.clinical.removeAllergy(id, allergyId, actor);
  }

  @Get('conditions')
  @RequirePermission('patients.clinical_read')
  listConditions(@Param('id', ParseUUIDPipe) id: string) {
    return this.clinical.listConditions(id);
  }

  @Post('conditions')
  @RequirePermission('patients.clinical_manage')
  addCondition(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateConditionDto,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.clinical.addCondition(id, dto, actor);
  }

  @Patch('conditions/:conditionId')
  @RequirePermission('patients.clinical_manage')
  updateCondition(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('conditionId', ParseUUIDPipe) conditionId: string,
    @Body() dto: UpdateConditionDto,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.clinical.updateCondition(id, conditionId, dto, actor);
  }

  @Delete('conditions/:conditionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('patients.clinical_manage')
  removeCondition(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('conditionId', ParseUUIDPipe) conditionId: string,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.clinical.removeCondition(id, conditionId, actor);
  }
}
