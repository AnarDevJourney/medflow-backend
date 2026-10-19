import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';
import { SLUG } from './update-sidebar-settings.dto';

// POST /configurations/sidebar/visits
export class RecordPageVisitDto {
  @ApiProperty({ example: 'patients' })
  @Matches(SLUG, {
    message:
      'pageKey must be a lowercase slug (a-z, 0-9, -), max 40 characters',
  })
  pageKey: string;
}
