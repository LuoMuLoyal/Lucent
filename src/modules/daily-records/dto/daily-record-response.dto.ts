import { ApiProperty } from '@nestjs/swagger';

import {
  DailyRecordListDataDto,
  DailyRecordSummaryDataDto,
} from './daily-record-data.dto';
import { DailyRecordItemDto } from './daily-record-item.dto';

export class DailyRecordListResponseDto {
  @ApiProperty({ example: 0 })
  code!: number;

  @ApiProperty({ example: '' })
  message!: string;

  @ApiProperty({ type: () => DailyRecordListDataDto })
  data!: DailyRecordListDataDto;
}

export class DailyRecordSummaryResponseDto {
  @ApiProperty({ example: 0 })
  code!: number;

  @ApiProperty({ example: '' })
  message!: string;

  @ApiProperty({ type: () => DailyRecordSummaryDataDto })
  data!: DailyRecordSummaryDataDto;
}

export class DailyRecordResponseDto {
  @ApiProperty({ example: 0 })
  code!: number;

  @ApiProperty({ example: '' })
  message!: string;

  @ApiProperty({ type: () => DailyRecordItemDto })
  data!: DailyRecordItemDto;
}
