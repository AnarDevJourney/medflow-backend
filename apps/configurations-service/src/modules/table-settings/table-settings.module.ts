import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TableSettings } from './entities/table-settings.entity';
import { TableSettingsController } from './table-settings.controller';
import { TableSettingsService } from './table-settings.service';

@Module({
  imports: [TypeOrmModule.forFeature([TableSettings])],
  controllers: [TableSettingsController],
  providers: [TableSettingsService],
})
export class TableSettingsModule {}
