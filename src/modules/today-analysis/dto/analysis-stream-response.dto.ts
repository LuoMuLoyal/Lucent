import { ApiProperty } from '@nestjs/swagger';
import { SseProblemDetailsDto } from '../../../common/index.js';
import { TodayAnalysisDataDto } from './analysis-response.dto.js';

export class TodayAnalysisStreamSummaryDto {
  @ApiProperty({ type: String })
  summary!: string;
}

export class TodayAnalysisStreamErrorDto extends SseProblemDetailsDto {}

export class TodayAnalysisStreamResultDto {
  @ApiProperty({
    enum: ['summary', 'result', 'error', 'done'],
    type: String,
  })
  event!: 'summary' | 'result' | 'error' | 'done';

  @ApiProperty({
    oneOf: [
      { $ref: '#/components/schemas/TodayAnalysisStreamSummaryDto' },
      { $ref: '#/components/schemas/TodayAnalysisDataDto' },
      { $ref: '#/components/schemas/TodayAnalysisStreamErrorDto' },
      {
        type: 'object',
        additionalProperties: false,
        description: 'Empty object for the done event.',
      },
    ],
    description:
      'Parsed SSE event data. event=summary => TodayAnalysisStreamSummaryDto; event=result => TodayAnalysisDataDto; event=error => TodayAnalysisStreamErrorDto; event=done => {}.',
  })
  data!:
    | TodayAnalysisStreamSummaryDto
    | TodayAnalysisDataDto
    | TodayAnalysisStreamErrorDto
    | Record<string, never>;
}
