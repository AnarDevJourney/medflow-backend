import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@medflow/common';
import type { CurrentUserData } from '@medflow/common';
import { AppointmentsService } from './appointments.service';
import { AvailabilityService } from './availability.service';
import { AvailabilityQueryDto } from './dto/availability-query.dto';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { ListAppointmentsQueryDto } from './dto/list-appointments-query.dto';

// DOC 8.5 — booking (7.1). Check-in / cancel / reschedule come in 7.2.
@ApiTags('appointments')
@Controller('appointments')
export class AppointmentsController {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly availabilityService: AvailabilityService,
  ) {}

  // Before :id, so 'availability' is not taken for an appointment id
  @Get('availability')
  @RequirePermission('appointments.availability')
  availability(@Query() query: AvailabilityQueryDto) {
    return this.availabilityService.availability(query);
  }

  @Get()
  @RequirePermission('appointments.read')
  list(
    @Query() query: ListAppointmentsQueryDto,
    @CurrentUser() viewer: CurrentUserData,
  ) {
    return this.appointments.list(query, viewer);
  }

  @Get(':id')
  @RequirePermission('appointments.read')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.appointments.findOne(id);
  }

  @Post()
  @RequirePermission('appointments.book')
  create(
    @Body() dto: CreateAppointmentDto,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.appointments.create(dto, actor);
  }
}
