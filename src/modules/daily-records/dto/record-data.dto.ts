import { ApiProperty } from '@nestjs/swagger';

import { DailyRecordItemDto } from './record-item.dto';
import { DailyRecordSummaryDto } from './record-summary.dto';

export class DailyRecordListDataDto {
  @ApiProperty({ type: () => DailyRecordItemDto, isArray: true })
  items!: DailyRecordItemDto[];

  @ApiProperty({
    description: 'Total records for the date (before pagination).',
  })
  total!: number;
}

export class DailyRecordSummaryDataDto {
  @ApiProperty({ type: () => DailyRecordSummaryDto, isArray: true })
  summaries!: DailyRecordSummaryDto[];
}
