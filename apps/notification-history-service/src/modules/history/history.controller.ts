import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@medflow/common';
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
  @RequirePermission('history.read')
  list(@Query() query: ListHistoryQueryDto) {
    return this.history.list(query);
  }

  @Get('entity/:entityType/:entityId')
  @RequirePermission('history.entity_read')
  forEntity(
    @Param() params: EntityHistoryParamsDto,
    @Query() query: HistoryRangeQueryDto,
  ) {
    return this.history.forEntity(params.entityType, params.entityId, query);
  }

  @Get('patients/:patientId')
  @RequirePermission('history.patient_read')
  forPatient(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query() query: HistoryRangeQueryDto,
  ) {
    return this.history.forPatient(patientId, query);
  }

  @Get('users/:userId')
  @RequirePermission('history.user_read')
  forUser(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: HistoryRangeQueryDto,
  ) {
    return this.history.forActor(userId, query);
  }
}
