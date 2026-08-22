import {
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';

export class TodayAnalysisBulletDto {
  @ApiProperty({
    enum: ['medication', 'hydration', 'sleep', 'general'],
  })
  kind!: 'medication' | 'hydration' | 'sleep' | 'general';

  @ApiProperty()
  text!: string;
}

export class TodayAnalysisObservedMetricDto {
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

export class TodayAnalysisMetricDto {
  @ApiProperty({ enum: ['medication', 'water', 'sleep'], type: String })
  kind!: 'medication' | 'water' | 'sleep';

  @ApiProperty({ type: () => TodayAnalysisObservedMetricDto })
  observedMetric!: TodayAnalysisObservedMetricDto;
}

export class TodayAnalysisDataDto {
  @ApiProperty()
  date!: string;

  @ApiProperty()
  generatedAt!: string;

  @ApiProperty({ required: false })
  sourceVersion?: number;

  @ApiProperty()
  summary!: string;

  @ApiProperty({ type: () => TodayAnalysisBulletDto, isArray: true })
  bullets!: TodayAnalysisBulletDto[];

  @ApiProperty()
  actionLabel!: string;

  @ApiProperty()
  action!: string;

  @ApiProperty()
  confidenceNote!: string;

  @ApiProperty({ type: Boolean })
  aiGenerated!: boolean;

  @ApiPropertyOptional({ type: () => [TodayAnalysisMetricDto] })
  metrics?: TodayAnalysisMetricDto[];
}

export class TodayAnalysisReadDataDto {
  @ApiProperty({ nullable: true, type: () => TodayAnalysisDataDto })
  analysis!: TodayAnalysisDataDto | null;

  @ApiProperty({
    enum: ['empty', 'pending', 'ready', 'stale', 'failed'],
    type: String,
  })
  status!: 'empty' | 'pending' | 'ready' | 'stale' | 'failed';

  @ApiProperty({ type: Number })
  sourceVersion!: number;

  @ApiProperty({ type: Number })
  computedVersion!: number;

  @ApiProperty({ type: String, nullable: true })
  computedAt!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  retryAfterSeconds!: number | null;
}

export class TodayAnalysisReadResponseDto extends TodayAnalysisReadDataDto {}

export class TodayAnalysisRefreshPendingDataDto {
  @ApiProperty({ enum: ['pending'], type: String })
  status!: 'pending';

  @ApiProperty({ type: String })
  jobId!: string;
}

export class TodayAnalysisRefreshReadyDataDto {
  @ApiProperty({ enum: ['ready'], type: String })
  status!: 'ready';

  @ApiProperty({ type: () => TodayAnalysisDataDto })
  analysis!: TodayAnalysisDataDto;
}

export class TodayAnalysisAsyncJobDataDto {
  @ApiProperty({ type: String })
  jobId!: string;
}

export class TodayAnalysisAsyncResultDataDto {
  @ApiProperty({
    oneOf: [
      { $ref: getSchemaPath(TodayAnalysisDataDto) },
      { $ref: getSchemaPath(TodayAnalysisReadDataDto) },
    ],
  })
  result!: TodayAnalysisDataDto | TodayAnalysisReadDataDto;
}

export class TodayAnalysisAsyncStatusDataDto {
  @ApiProperty({
    enum: ['empty', 'pending', 'ready', 'stale', 'failed'],
    type: String,
  })
  status!: 'empty' | 'pending' | 'ready' | 'stale' | 'failed';
}
