import { ApiProperty } from '@nestjs/swagger';
import { REPORT_RANGE_LAST_7_DAYS } from './report-dashboard-query.dto';

export class ReportWeeklySummaryBulletDto {
  @ApiProperty({
    enum: ['medication', 'hydration', 'sleep', 'general'],
  })
  kind!: 'medication' | 'hydration' | 'sleep' | 'general';

  @ApiProperty()
  text!: string;
}

export class ReportWeeklySummaryDataDto {
  @ApiProperty({
    enum: [REPORT_RANGE_LAST_7_DAYS],
  })
  range!: 'last_7_days';

  @ApiProperty()
  startDate!: string;

  @ApiProperty()
  endDate!: string;

  @ApiProperty()
  generatedAt!: string;

  @ApiProperty()
  summary!: string;

  @ApiProperty({ type: () => ReportWeeklySummaryBulletDto, isArray: true })
  bullets!: ReportWeeklySummaryBulletDto[];

  @ApiProperty()
  actionLabel!: string;

  @ApiProperty()
  confidenceNote!: string;
}

export class ReportWeeklySummaryResponseDto {
  @ApiProperty({ example: 0 })
  code!: number;

  @ApiProperty({ example: '' })
  message!: string;

  @ApiProperty({ type: () => ReportWeeklySummaryDataDto })
  data!: ReportWeeklySummaryDataDto;
}
