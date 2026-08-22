import {
  DailyRecordListDataDto,
  DailyRecordSummaryDataDto,
} from './record-data.dto';
import { DailyRecordItemDto } from './record-item.dto';

export class DailyRecordListResponseDto extends DailyRecordListDataDto {}

export class DailyRecordSummaryResponseDto extends DailyRecordSummaryDataDto {}

export class DailyRecordResponseDto extends DailyRecordItemDto {}
