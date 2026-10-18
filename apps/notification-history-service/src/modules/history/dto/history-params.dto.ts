import { IsUUID, Matches } from 'class-validator';
import { ENTITY_TYPE } from './history-query.dto';

// /history/entity/:entityType/:entityId
export class EntityHistoryParamsDto {
  @Matches(ENTITY_TYPE, { message: 'entityType must look like "LAB_ORDER"' })
  entityType: string;

  @IsUUID()
  entityId: string;
}
