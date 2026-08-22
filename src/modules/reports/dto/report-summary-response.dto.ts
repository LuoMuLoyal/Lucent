import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  REPORT_SUPPORTED_RANGES,
  type ReportRange,
} from './report-dashboard-query.dto';

export class ReportCoverageDimensionDto {
  @ApiProperty()
  trackedDays!: number;

  @ApiProperty()
  totalDays!: number;
}

export class ReportCoverageDto {
  @ApiProperty({ type: () => ReportCoverageDimensionDto })
  medication!: ReportCoverageDimensionDto;

  @ApiProperty({ type: () => ReportCoverageDimensionDto })
  water!: ReportCoverageDimensionDto;

  @ApiProperty({ type: () => ReportCoverageDimensionDto })
  sleep!: ReportCoverageDimensionDto;
}

export class ReportObservedPatternDto {
  @ApiProperty({ enum: ['medication', 'hydration', 'sleep'] })
  kind!: 'medication' | 'hydration' | 'sleep';

  @ApiProperty()
  text!: string;

  @ApiProperty()
  source!: string;
}

export class ReportLowRiskActionDto {
  @ApiProperty()
  label!: string;

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

  @ApiProperty({ type: () => ReportCoverageDto })
  coverage!: ReportCoverageDto;

  @ApiPropertyOptional({
    type: () => ReportObservedPatternDto,
    nullable: true,
    description:
      'At most one source-backed observed pattern. Null when data is insufficient.',
  })
  observedPattern!: ReportObservedPatternDto | null;

  @ApiPropertyOptional({
    type: () => ReportLowRiskActionDto,
    nullable: true,
    description:
      'At most one low-risk action. Null when no action is warranted.',
  })
  lowRiskAction!: ReportLowRiskActionDto | null;

  @ApiProperty()
  disclaimer!: string;
}

export class ReportSummaryResponseDto extends ReportSummaryDataDto {}
