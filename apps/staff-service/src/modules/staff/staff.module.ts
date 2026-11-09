import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StaffMember } from './entities/staff-member.entity';
import { StaffSyncService } from './staff-sync.service';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';

@Module({
  imports: [TypeOrmModule.forFeature([StaffMember])],
  controllers: [StaffController],
  providers: [StaffService, StaffSyncService],
  exports: [StaffSyncService],
})
export class StaffModule {}
