import { ApiProperty } from '@nestjs/swagger';
import {
  REPORT_SUPPORTED_RANGES,
  type ReportRange,
} from './report-dashboard-query.dto';

export class ReportSummaryBulletDto {
  @ApiProperty({
    enum: ['medication', 'hydration', 'sleep', 'general'],
  })
  kind!: 'medication' | 'hydration' | 'sleep' | 'general';

  @ApiProperty()
  text!: string;
}

export class ReportSummaryDataDto {
  @ApiProperty({
    enum: REPORT_SUPPORTED_RANGES,
  })
  range!: ReportRange;

  @ApiProperty()
  startDate!: string;

  @ApiProperty()
  endDate!: string;

  @ApiProperty()
  generatedAt!: string;

  @ApiProperty()
  summary!: string;

  @ApiProperty({ type: () => ReportSummaryBulletDto, isArray: true })
  bullets!: ReportSummaryBulletDto[];

  @ApiProperty()
  actionLabel!: string;

  @ApiProperty()
  action!: string;

  @ApiProperty()
  confidenceNote!: string;
}

export class ReportSummaryResponseDto {
  @ApiProperty({ example: 0 })
  code!: number;

  @ApiProperty({ example: '' })
  message!: string;

  @ApiProperty({ type: () => ReportSummaryDataDto })
  data!: ReportSummaryDataDto;
}
