import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DoctorDayService } from './doctor-day.service';
import { DoctorDayQueryDto } from './dto/doctor-day-query.dto';

// Service-to-service only (x-internal-key, never routed by the gateway).
// appointment-service asks here whether a doctor works on a day, and when.
// "Not working" is a normal answer (200), not an error.
@ApiTags('internal')
@Controller('internal/doctors')
export class InternalDoctorsController {
  constructor(private readonly doctorDay: DoctorDayService) {}

  @Get(':userId/day')
  day(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: DoctorDayQueryDto,
  ) {
    return this.doctorDay.day(userId, query.date);
  }
}
