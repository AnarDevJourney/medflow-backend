import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppointmentsService } from './appointments.service';

// Service-to-service only (x-internal-key, never routed by the gateway).
// medical-record-service starts a visit from it (phase 8): status must be
// CHECKED_IN and doctorId the current user.
@ApiTags('internal')
@Controller('internal/appointments')
export class InternalAppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.appointments.findOne(id);
  }
}
