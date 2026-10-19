import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThemeSettings } from './entities/theme-settings.entity';
import { ThemeSettingsController } from './theme-settings.controller';
import { ThemeSettingsService } from './theme-settings.service';

@Module({
  imports: [TypeOrmModule.forFeature([ThemeSettings])],
  controllers: [ThemeSettingsController],
  providers: [ThemeSettingsService],
})
export class ThemeSettingsModule {}
