import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  REPORT_SUPPORTED_RANGES,
  type ReportRange,
} from './report-dashboard-query.dto';

export class ReportObservedMetricDto {
  @ApiProperty({ type: Number, nullable: true })
  value!: number | null;

  @ApiProperty({ enum: ['observed', 'unknown'], type: String })
  state!: 'observed' | 'unknown';

  @ApiProperty({ enum: ['sufficient', 'partial', 'none'], type: String })
  coverage!: 'sufficient' | 'partial' | 'none';

  @ApiProperty({
    enum: ['manual', 'health_platform', 'reminder_plan', 'derived'],
    isArray: true,
    type: String,
  })
  sources!: Array<'manual' | 'health_platform' | 'reminder_plan' | 'derived'>;

  @ApiProperty({ type: Number })
  observedCount!: number;

  @ApiProperty({ type: Number, nullable: true })
  expectedCount!: number | null;

  @ApiProperty({ type: String })
  windowStart!: string;

  @ApiProperty({ type: String })
  windowEnd!: string;
}

export class ReportMetricDto {
  @ApiProperty({
    enum: ['medication', 'water', 'sleep'],
  })
  kind!: 'medication' | 'water' | 'sleep';

  @ApiProperty({ deprecated: true })
  value!: string;

  @ApiProperty({ deprecated: true })
  unit!: string;

  @ApiProperty({
    enum: ['good', 'stable', 'needs_attention', 'insufficient_data'],
    deprecated: true,
  })
  status!: 'good' | 'stable' | 'needs_attention' | 'insufficient_data';

  @ApiProperty({ deprecated: true })
  delta!: string;

  @ApiProperty({
    enum: ['up', 'down', 'flat'],
    deprecated: true,
  })
  direction!: 'up' | 'down' | 'flat';

  @ApiProperty({ type: [Number], deprecated: true })
  sparkline!: number[];

  @ApiPropertyOptional({ type: () => ReportObservedMetricDto })
  observedMetric?: ReportObservedMetricDto;
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

  @ApiProperty({
    type: [Number],
    description:
      'Observed values only — unknown days are omitted, not zero-filled.',
  })
  values!: number[];

  @ApiPropertyOptional({ type: () => ReportObservedMetricDto })
  observedMetric?: ReportObservedMetricDto;
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

export class ReportDashboardResponseDto extends ReportDashboardDataDto {}
