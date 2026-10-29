import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@medflow/common';
import { ListEmailLogsQueryDto } from './dto/list-email-logs-query.dto';
import { EmailLogsService } from './email-logs.service';

// Email log with status (DOC 8.9)
@ApiTags('history')
@Controller('history/emails')
@RequirePermission('emails.read')
export class EmailLogsController {
  constructor(private readonly logs: EmailLogsService) {}

  @Get()
  list(@Query() query: ListEmailLogsQueryDto) {
    return this.logs.list(query);
  }
}
