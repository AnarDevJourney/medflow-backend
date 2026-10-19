import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';
import { SLUG } from '../../sidebar-settings/dto/update-sidebar-settings.dto';

// /configurations/tables/:tableKey — e.g. 'patients', 'invoices', 'lab-queue'
export class TableKeyParam {
  @ApiProperty({ example: 'patients' })
  @Matches(SLUG, {
    message:
      'tableKey must be a lowercase slug (a-z, 0-9, -), max 40 characters',
  })
  tableKey: string;
}
