import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, RequirePermission } from '@medflow/common';
import type { CurrentUserData } from '@medflow/common';
import { StartEncounterDto, UpdateEncounterDto } from './dto/encounter.dto';
import { EncountersService } from './encounters.service';

// DOC 8.6 — visits. Reading: doctors and nurses (encounters.read); writing:
// the visit's own doctor (encounters.manage + ownership in the service).
@ApiTags('encounters')
@Controller('encounters')
export class EncountersController {
  constructor(private readonly encounters: EncountersService) {}

  // 201 = started now, 200 = the visit already open for this appointment
  @Post()
  @RequirePermission('encounters.manage')
  async start(
    @Body() dto: StartEncounterDto,
    @CurrentUser() actor: CurrentUserData,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { encounter, created } = await this.encounters.start(dto, actor);
    res.status(created ? 201 : 200);
    return encounter;
  }

  @Get(':id')
  @RequirePermission('encounters.read')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.encounters.findOne(id);
  }

  @Patch(':id')
  @RequirePermission('encounters.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEncounterDto,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.encounters.update(id, dto, actor);
  }

  @Patch(':id/close')
  @RequirePermission('encounters.manage')
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.encounters.close(id, actor);
  }
}
