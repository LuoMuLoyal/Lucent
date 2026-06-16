import { ApiProperty } from '@nestjs/swagger';

export class ReportSummaryStreamSummaryDto {
  @ApiProperty()
  summary!: string;
}

export class ReportSummaryStreamResultDto {
  @ApiProperty({ enum: ['summary', 'result', 'error', 'done'] })
  event!: 'summary' | 'result' | 'error' | 'done';

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'SSE payload object. event=summary => { summary }, event=result => ReportSummaryDataDto-like object, event=error => { message, code?, statusCode? }, event=done => {}.',
  })
  data!: Record<string, unknown>;
}
