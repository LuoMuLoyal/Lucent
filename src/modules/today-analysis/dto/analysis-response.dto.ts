import { ApiProperty, getSchemaPath } from '@nestjs/swagger';

export class TodayAnalysisBulletDto {
  @ApiProperty({
    enum: ['medication', 'hydration', 'sleep', 'general'],
  })
  kind!: 'medication' | 'hydration' | 'sleep' | 'general';

  @ApiProperty()
  text!: string;
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

export class TodayAnalysisReadResponseDto {
  @ApiProperty({ type: Number, example: 0 })
  code!: number;

  @ApiProperty({ type: String, example: '' })
  message!: string;

  @ApiProperty({ type: () => TodayAnalysisReadDataDto })
  data!: TodayAnalysisReadDataDto;
}

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

export class TodayAnalysisRefreshResponseDto {
  @ApiProperty({ type: Number, example: 0 })
  code!: number;

  @ApiProperty({ type: String, example: '' })
  message!: string;

  @ApiProperty({
    oneOf: [
      { $ref: getSchemaPath(TodayAnalysisDataDto) },
      { $ref: getSchemaPath(TodayAnalysisReadDataDto) },
      { $ref: getSchemaPath(TodayAnalysisRefreshPendingDataDto) },
      { $ref: getSchemaPath(TodayAnalysisRefreshReadyDataDto) },
    ],
  })
  data!:
    | TodayAnalysisDataDto
    | TodayAnalysisReadDataDto
    | TodayAnalysisRefreshPendingDataDto
    | TodayAnalysisRefreshReadyDataDto;
}

export class TodayAnalysisGenerateResponseDto {
  @ApiProperty({ type: Number, example: 0 })
  code!: number;

  @ApiProperty({ type: String, example: '' })
  message!: string;

  @ApiProperty({
    oneOf: [
      { $ref: getSchemaPath(TodayAnalysisDataDto) },
      { $ref: getSchemaPath(TodayAnalysisReadDataDto) },
    ],
  })
  data!: TodayAnalysisDataDto | TodayAnalysisReadDataDto;
}

export class TodayAnalysisAsyncJobDataDto {
  @ApiProperty({ type: String })
  jobId!: string;
}

export class TodayAnalysisAsyncResultDataDto {
  @ApiProperty({ type: () => TodayAnalysisDataDto })
  result!: TodayAnalysisDataDto;
}

export class TodayAnalysisAsyncStatusDataDto {
  @ApiProperty({
    enum: ['empty', 'pending', 'ready', 'stale', 'failed'],
    type: String,
  })
  status!: 'empty' | 'pending' | 'ready' | 'stale' | 'failed';
}

export class TodayAnalysisAsyncResponseDto {
  @ApiProperty({ type: Number, example: 0 })
  code!: number;

  @ApiProperty({ type: String, example: '' })
  message!: string;

  @ApiProperty({
    oneOf: [
      { $ref: getSchemaPath(TodayAnalysisAsyncJobDataDto) },
      { $ref: getSchemaPath(TodayAnalysisAsyncResultDataDto) },
      { $ref: getSchemaPath(TodayAnalysisAsyncStatusDataDto) },
    ],
  })
  data!:
    | TodayAnalysisAsyncJobDataDto
    | TodayAnalysisAsyncResultDataDto
    | TodayAnalysisAsyncStatusDataDto;
}
