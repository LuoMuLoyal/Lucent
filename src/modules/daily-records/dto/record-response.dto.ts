import {
  DailyRecordListDataDto,
  DailyRecordSummaryDataDto,
} from './record-data.dto.js';
import { DailyRecordItemDto } from './record-item.dto.js';

export class DailyRecordListResponseDto extends DailyRecordListDataDto {}

export class DailyRecordSummaryResponseDto extends DailyRecordSummaryDataDto {}

export class DailyRecordResponseDto extends DailyRecordItemDto {}
