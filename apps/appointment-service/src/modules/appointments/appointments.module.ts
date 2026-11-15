import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppointmentStatsService } from './appointment-stats.service';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { AvailabilityService } from './availability.service';
import { CalendarService } from './calendar.service';
import { PatientClient } from './clients/patient.client';
import { StaffClient } from './clients/staff.client';
import { Appointment } from './entities/appointment.entity';
import { InternalAppointmentsController } from './internal-appointments.controller';
import { AppointmentJobsService } from './jobs/appointment-jobs.service';
import { InternalJobsController } from './jobs/internal-jobs.controller';
import { PatientSyncService } from './patient-sync.service';

@Module({
  imports: [TypeOrmModule.forFeature([Appointment])],
  controllers: [
    AppointmentsController,
    InternalAppointmentsController,
    InternalJobsController,
  ],
  providers: [
    AppointmentsService,
    AvailabilityService,
    CalendarService,
    AppointmentStatsService,
    AppointmentJobsService,
    PatientSyncService,
    StaffClient,
    PatientClient,
  ],
  exports: [PatientSyncService],
})
export class AppointmentsModule {}
