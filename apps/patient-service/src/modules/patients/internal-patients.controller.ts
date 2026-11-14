import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InternalPatientsService } from './internal-patients.service';

// Service-to-service only (x-internal-key, never routed by the gateway).
// appointment-service validates a patient and snapshots it when booking;
// medical-record-service checks prescriptions against the allergies.
// An inactive patient is a normal answer (isActive: false), not an error.
@ApiTags('internal')
@Controller('internal/patients')
export class InternalPatientsController {
  constructor(private readonly internal: InternalPatientsService) {}

  @Get(':id/summary')
  summary(@Param('id', ParseUUIDPipe) id: string) {
    return this.internal.summary(id);
  }

  @Get(':id/allergies')
  allergies(@Param('id', ParseUUIDPipe) id: string) {
    return this.internal.allergies(id);
  }
}
