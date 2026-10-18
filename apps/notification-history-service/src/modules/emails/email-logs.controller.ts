import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role, Roles } from '@medflow/common';
import { ListEmailLogsQueryDto } from './dto/list-email-logs-query.dto';
import { EmailLogsService } from './email-logs.service';

// Email log with status — ADMIN (DOC 8.9)
@ApiTags('history')
@Controller('history/emails')
@Roles(Role.ADMIN)
export class EmailLogsController {
  constructor(private readonly logs: EmailLogsService) {}

  @Get()
  list(@Query() query: ListEmailLogsQueryDto) {
    return this.logs.list(query);
  }
}
