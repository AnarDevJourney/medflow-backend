import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActionHistoryConsumer } from '../../consumers/action-history.consumer';
import { ActionHistory } from './entities/action-history.entity';
import { HistoryController } from './history.controller';
import { HistoryService } from './history.service';
import { HistoryMapper } from './mapper/history.mapper';

@Module({
  imports: [TypeOrmModule.forFeature([ActionHistory])],
  controllers: [HistoryController],
  providers: [HistoryService, HistoryMapper, ActionHistoryConsumer],
})
export class HistoryModule {}
