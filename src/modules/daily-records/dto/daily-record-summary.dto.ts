import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { DailyRecordKind } from '../../../generated/prisma/client';
import { DailyRecordItemDto } from './daily-record-item.dto';

export class DailyRecordSummaryDto {
  @ApiProperty({ enum: DailyRecordKind, enumName: 'DailyRecordKind' })
  kind!: DailyRecordKind;

  @ApiProperty({
    description: 'Count of records for this kind on the given date.',
  })
  count!: number;

  @ApiPropertyOptional({
    type: () => DailyRecordItemDto,
    description: 'Most recent record of this kind.',
  })
  latest?: DailyRecordItemDto | null;
}
