import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@medflow/common';
import type { CurrentUserData } from '@medflow/common';
import { AppointmentStatsService } from './appointment-stats.service';
import { AppointmentsService } from './appointments.service';
import { AvailabilityService } from './availability.service';
import { CalendarService } from './calendar.service';
import { CalendarQueryDto } from './dto/calendar-query.dto';
import { AvailabilityQueryDto } from './dto/availability-query.dto';
import {
  CancelAppointmentDto,
  RescheduleAppointmentDto,
  TodayQueryDto,
  UpdateAppointmentDto,
} from './dto/change-appointment.dto';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { ListAppointmentsQueryDto } from './dto/list-appointments-query.dto';
import { StatsQueryDto } from './dto/stats-query.dto';

// DOC 8.5. Cancel / reschedule / edit share appointments.book with booking
// (the same desk roles); PATCH /:id (type, reason, notes) is our addition.
@ApiTags('appointments')
@Controller('appointments')
export class AppointmentsController {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly availabilityService: AvailabilityService,
    private readonly calendarService: CalendarService,
    private readonly statsService: AppointmentStatsService,
  ) {}

  // Fixed paths before :id, so they are not taken for an appointment id
  @Get('availability')
  @RequirePermission('appointments.availability')
  availability(@Query() query: AvailabilityQueryDto) {
    return this.availabilityService.availability(query);
  }

  @Get('calendar')
  @RequirePermission('appointments.read')
  calendar(@Query() query: CalendarQueryDto) {
    return this.calendarService.calendar(query);
  }

  @Get('stats/overview')
  @RequirePermission('appointments.stats')
  statsOverview(@Query() query: StatsQueryDto) {
    return this.statsService.overview(query);
  }

  @Get('stats/doctor')
  @RequirePermission('appointments.stats_own')
  statsDoctor(@CurrentUser() viewer: CurrentUserData) {
    return this.statsService.forDoctor(viewer.id);
  }

  @Get('today')
  @RequirePermission('appointments.read')
  today(@Query() query: TodayQueryDto, @CurrentUser() viewer: CurrentUserData) {
    return this.appointments.today(query, viewer);
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

  @Patch(':id')
  @RequirePermission('appointments.book')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAppointmentDto,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.appointments.update(id, dto, actor);
  }

  @Patch(':id/reschedule')
  @RequirePermission('appointments.book')
  reschedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RescheduleAppointmentDto,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.appointments.reschedule(id, dto, actor);
  }

  @Patch(':id/cancel')
  @RequirePermission('appointments.book')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelAppointmentDto,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.appointments.cancel(id, dto, actor);
  }

  @Patch(':id/check-in')
  @RequirePermission('appointments.check_in')
  checkIn(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.appointments.checkIn(id, actor);
  }
}
