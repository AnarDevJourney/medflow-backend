import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StaffMember } from '../staff/entities/staff-member.entity';
import { TimeOff } from '../time-off/entities/time-off.entity';
import { DoctorDayService } from './doctor-day.service';
import { DoctorSchedule } from './entities/doctor-schedule.entity';
import { InternalDoctorsController } from './internal-doctors.controller';
import { SchedulesController } from './schedules.controller';
import { SchedulesService } from './schedules.service';

@Module({
  imports: [TypeOrmModule.forFeature([DoctorSchedule, StaffMember, TimeOff])],
  controllers: [SchedulesController, InternalDoctorsController],
  providers: [SchedulesService, DoctorDayService],
})
export class SchedulesModule {}
