import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InternalStaffQueryDto } from './dto/list-staff-query.dto';
import { StaffService } from './staff.service';

// Service-to-service only (x-internal-key, never routed by the gateway).
// notification-service picks recipients by role / department here.
@ApiTags('internal')
@Controller('internal/staff')
export class InternalStaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  list(@Query() query: InternalStaffQueryDto) {
    return this.staff.listForInternal(query);
  }
}
