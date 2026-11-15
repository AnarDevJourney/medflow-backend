import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppointmentJobsService } from './appointment-jobs.service';

// Service-to-service / operator only (x-internal-key, never routed by the
// gateway): run the jobs now instead of waiting 15 minutes or 24 hours —
// e2e scripts and support use these.
@ApiTags('internal')
@Controller('internal/jobs')
export class InternalJobsController {
  constructor(private readonly jobs: AppointmentJobsService) {}

  @Post('no-show-sweep')
  @HttpCode(200)
  async sweep() {
    return { marked: await this.jobs.sweepNoShows() };
  }

  @Post('reminders/:id/run')
  @HttpCode(200)
  async remind(@Param('id', ParseUUIDPipe) id: string) {
    return { sent: await this.jobs.sendReminder(id) };
  }

  // The planned reminder of an appointment: { planned, delayMs }
  @Get('reminders/:id')
  async reminder(@Param('id', ParseUUIDPipe) id: string) {
    const delayMs = await this.jobs.reminderDelay(id);
    return { planned: delayMs !== null, delayMs };
  }
}
