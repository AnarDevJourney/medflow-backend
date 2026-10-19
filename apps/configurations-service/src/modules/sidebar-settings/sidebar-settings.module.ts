import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SidebarSettings } from './entities/sidebar-settings.entity';
import { SidebarSettingsController } from './sidebar-settings.controller';
import { SidebarSettingsService } from './sidebar-settings.service';

@Module({
  imports: [TypeOrmModule.forFeature([SidebarSettings])],
  controllers: [SidebarSettingsController],
  providers: [SidebarSettingsService],
})
export class SidebarSettingsModule {}
