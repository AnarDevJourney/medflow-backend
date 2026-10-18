import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role, Roles } from '@medflow/common';
import { EntityHistoryParamsDto } from './dto/history-params.dto';
import {
  HistoryRangeQueryDto,
  ListHistoryQueryDto,
} from './dto/history-query.dto';
import { HistoryService } from './history.service';

// Action history / audit log (DOC 8.9). /history/emails lives in
// EmailLogsController.
@ApiTags('history')
@Controller('history')
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  @Get()
  @Roles(Role.ADMIN)
  list(@Query() query: ListHistoryQueryDto) {
    return this.history.list(query);
  }

  @Get('entity/:entityType/:entityId')
  @Roles(Role.ADMIN, Role.DOCTOR, Role.NURSE, Role.ACCOUNTANT)
  forEntity(
    @Param() params: EntityHistoryParamsDto,
    @Query() query: HistoryRangeQueryDto,
  ) {
    return this.history.forEntity(params.entityType, params.entityId, query);
  }

  @Get('patients/:patientId')
  @Roles(Role.ADMIN, Role.DOCTOR, Role.NURSE)
  forPatient(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query() query: HistoryRangeQueryDto,
  ) {
    return this.history.forPatient(patientId, query);
  }

  @Get('users/:userId')
  @Roles(Role.ADMIN)
  forUser(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: HistoryRangeQueryDto,
  ) {
    return this.history.forActor(userId, query);
  }
}
