import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { AvailabilityService } from './availability.service';
import { PatientClient } from './clients/patient.client';
import { StaffClient } from './clients/staff.client';
import { Appointment } from './entities/appointment.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Appointment])],
  controllers: [AppointmentsController],
  providers: [
    AppointmentsService,
    AvailabilityService,
    StaffClient,
    PatientClient,
  ],
})
export class AppointmentsModule {}
