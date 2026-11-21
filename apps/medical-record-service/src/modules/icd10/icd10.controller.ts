import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  AppException,
  CurrentUser,
  ErrorCode,
  RequirePermission,
} from '@medflow/common';
import type { CurrentUserData } from '@medflow/common';
import {
  Icd10CatalogQueryDto,
  SearchIcd10Dto,
  UpdateIcd10Dto,
} from './dto/icd10.dto';
import { Icd10Service } from './icd10.service';

// "I10", "J45.9", "O9A.2"
const CODE = /^[A-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$/;

// DOC 8.6 — ICD-10. Doctors: autocomplete + their frequent codes.
// Admins (icd10.manage): the catalogue page.
@ApiTags('icd10')
@Controller('icd10')
export class Icd10Controller {
  constructor(private readonly icd10: Icd10Service) {}

  @Get()
  @RequirePermission('diagnoses.manage')
  search(@Query() query: SearchIcd10Dto) {
    return this.icd10.search(query.search);
  }

  @Get('frequent')
  @RequirePermission('diagnoses.manage')
  frequent(@CurrentUser() actor: CurrentUserData) {
    return this.icd10.frequent(actor.id);
  }

  @Get('catalog')
  @RequirePermission('icd10.manage')
  catalog(@Query() query: Icd10CatalogQueryDto) {
    return this.icd10.catalog(query);
  }

  @Patch(':code')
  @RequirePermission('icd10.manage')
  update(
    @Param('code') code: string,
    @Body() dto: UpdateIcd10Dto,
    @CurrentUser() actor: CurrentUserData,
  ) {
    const normalized = code.trim().toUpperCase();
    if (!CODE.test(normalized)) {
      throw new AppException(
        400,
        ErrorCode.VALIDATION_ERROR,
        'Invalid ICD-10 code',
        {
          field: 'code',
        },
      );
    }
    return this.icd10.update(normalized, dto, actor);
  }
}
