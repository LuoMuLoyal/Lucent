import { ApiProperty } from '@nestjs/swagger';
import {
  REPORT_SUPPORTED_RANGES,
  type ReportRange,
} from './report-dashboard-query.dto';

export class ReportDashboardScoreDto {
  @ApiProperty()
  value!: number;

  @ApiProperty()
  maxValue!: number;

  @ApiProperty({
    enum: ['good', 'stable', 'needs_attention', 'insufficient_data'],
  })
  status!: 'good' | 'stable' | 'needs_attention' | 'insufficient_data';

  @ApiProperty()
  summary!: string;
}

export class ReportMetricDto {
  @ApiProperty({
    enum: ['medication', 'water', 'sleep'],
  })
  kind!: 'medication' | 'water' | 'sleep';

  @ApiProperty()
  value!: string;

  @ApiProperty()
  unit!: string;

  @ApiProperty({
    enum: ['good', 'stable', 'needs_attention', 'insufficient_data'],
  })
  status!: 'good' | 'stable' | 'needs_attention' | 'insufficient_data';

  @ApiProperty()
  delta!: string;

  @ApiProperty({
    enum: ['up', 'down', 'flat'],
  })
  direction!: 'up' | 'down' | 'flat';

  @ApiProperty({ type: [Number] })
  sparkline!: number[];
}

export class ReportTrendDto {
  @ApiProperty({
    enum: ['medication', 'water', 'sleep'],
  })
  kind!: 'medication' | 'water' | 'sleep';

  @ApiProperty()
  unit!: string;

  @ApiProperty()
  currentValue!: string;

  @ApiProperty({ type: [Number] })
  values!: number[];
}

export class ReportFindingDto {
  @ApiProperty({
    enum: ['medication', 'hydration', 'sleep', 'general'],
  })
  kind!: 'medication' | 'hydration' | 'sleep' | 'general';

  @ApiProperty()
  title!: string;

  @ApiProperty()
  body!: string;
}

export class ReportPatternDto {
  @ApiProperty({
    enum: ['medication', 'hydration', 'sleep', 'general'],
  })
  kind!: 'medication' | 'hydration' | 'sleep' | 'general';

  @ApiProperty()
  title!: string;

  @ApiProperty({
    enum: ['good', 'stable', 'needs_attention', 'insufficient_data'],
  })
  status!: 'good' | 'stable' | 'needs_attention' | 'insufficient_data';

  @ApiProperty()
  body!: string;

  @ApiProperty({ type: [Number] })
  sparkline!: number[];
}

export class ReportDashboardDataDto {
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

  @ApiProperty({ type: ReportDashboardScoreDto })
  score!: ReportDashboardScoreDto;

  @ApiProperty({ type: [ReportMetricDto] })
  metrics!: ReportMetricDto[];

  @ApiProperty({ type: [ReportTrendDto] })
  trends!: ReportTrendDto[];

  @ApiProperty({ type: [ReportFindingDto] })
  findings!: ReportFindingDto[];

  @ApiProperty({ type: [ReportPatternDto] })
  patterns!: ReportPatternDto[];

  @ApiProperty()
  aiSummaryEnabled!: boolean;
}

export class ReportDashboardResponseDto {
  @ApiProperty({ example: 0 })
  code!: number;

  @ApiProperty({ example: '' })
  message!: string;

  @ApiProperty({ type: ReportDashboardDataDto })
  data!: ReportDashboardDataDto;
}
