import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type MedicineRiskLevel = 'safe' | 'caution' | 'risk' | 'danger';

export type MedicineRiskFindingType =
  | 'interaction'
  | 'duplicateIngredient'
  | 'allergy'
  | 'foodInteraction'
  | 'longTermUse'
  | 'schedulingConflict'
  | 'specialGroup';

export type MedicineRiskSeverity = 'high' | 'medium' | 'info';

export type MedicineRiskFindingContext = 'none' | 'alcohol' | 'caffeine';

export type MedicineRiskCoverageReason =
  | 'manualEntry'
  | 'missingSourceRef'
  | 'detailUnavailable';

export type MedicineRedFlagRule = 'severeAllergy' | 'informationGap';

export class MedicineRiskFindingDto {
  @ApiProperty({
    enum: [
      'interaction',
      'duplicateIngredient',
      'allergy',
      'foodInteraction',
      'longTermUse',
      'schedulingConflict',
      'specialGroup',
    ],
  })
  type!: MedicineRiskFindingType;

  @ApiProperty({ enum: ['high', 'medium', 'info'] })
  severity!: MedicineRiskSeverity;

  @ApiProperty({ enum: ['none', 'alcohol', 'caffeine'] })
  context!: MedicineRiskFindingContext;

  @ApiProperty()
  primaryMedicineName!: string;

  @ApiPropertyOptional()
  secondaryMedicineName?: string;

  @ApiPropertyOptional()
  relatedLabel?: string;

  @ApiPropertyOptional()
  evidence?: string;

  @ApiPropertyOptional({ description: 'LLM check only' })
  recommendation?: string;
}

export class MedicineRiskCoverageIssueDto {
  @ApiProperty()
  medicineName!: string;

  @ApiProperty({
    enum: ['manualEntry', 'missingSourceRef', 'detailUnavailable'],
  })
  reason!: MedicineRiskCoverageReason;
}

export class MedicineRedFlagDto {
  @ApiProperty({ enum: ['severeAllergy', 'informationGap'] })
  rule!: MedicineRedFlagRule;

  @ApiProperty()
  primaryMedicineName!: string;

  @ApiPropertyOptional()
  relatedLabel?: string;
}

export class MedicineRiskCheckResponseDto {
  @ApiProperty({ enum: ['safe', 'caution', 'risk', 'danger'] })
  overallRiskLevel!: MedicineRiskLevel;

  @ApiProperty({ minimum: 0, maximum: 100 })
  overallRiskScore!: number;

  @ApiProperty()
  currentMedicineCount!: number;

  @ApiProperty()
  checkedMedicineCount!: number;

  @ApiProperty({ type: [MedicineRiskFindingDto] })
  findings!: MedicineRiskFindingDto[];

  @ApiProperty({ type: [MedicineRiskCoverageIssueDto] })
  coverageIssues!: MedicineRiskCoverageIssueDto[];

  @ApiProperty({ type: [MedicineRedFlagDto] })
  redFlags!: MedicineRedFlagDto[];

  @ApiPropertyOptional({ description: 'LLM check only' })
  overallRecommendation?: string;
}

export class MedicineRiskCheckRecordDto {
  @ApiProperty({ enum: ['static', 'llm'] })
  checkType!: 'static' | 'llm';

  @ApiProperty({ type: MedicineRiskCheckResponseDto })
  result!: MedicineRiskCheckResponseDto;

  @ApiProperty({ minimum: 0, maximum: 100 })
  riskScore!: number;

  @ApiProperty({ enum: ['safe', 'caution', 'risk', 'danger'] })
  riskLevel!: MedicineRiskLevel;

  @ApiProperty()
  stale!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class MedicineRiskCheckRecordsDto {
  @ApiProperty({
    type: MedicineRiskCheckRecordDto,
    nullable: true,
    description: 'Latest static check record, null if never checked',
  })
  static!: MedicineRiskCheckRecordDto | null;

  @ApiProperty({
    type: MedicineRiskCheckRecordDto,
    nullable: true,
    description: 'Latest LLM check record, null if never checked',
  })
  llm!: MedicineRiskCheckRecordDto | null;
}

/** Envelope wrapper for GET /risk-check (list of records). */
export class MedicineRiskCheckRecordsResponseDto {
  @ApiProperty({ example: 0 })
  code!: number;

  @ApiProperty({ example: '' })
  message!: string;

  @ApiProperty({ type: () => MedicineRiskCheckRecordsDto })
  data!: MedicineRiskCheckRecordsDto;
}

/** Envelope wrapper for POST /risk-check (single record). */
export class MedicineRiskCheckRecordResponseDto {
  @ApiProperty({ example: 0 })
  code!: number;

  @ApiProperty({ example: '' })
  message!: string;

  @ApiProperty({ type: () => MedicineRiskCheckRecordDto })
  data!: MedicineRiskCheckRecordDto;
}
