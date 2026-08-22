import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** HTTP error representation emitted by the global Problem Details filter. */
export class ProblemDetailsDto {
  @ApiProperty({
    description: 'Stable URI identifying the problem type.',
    example: 'https://api.lumos.example/problems/resource-not-found',
  })
  type!: string;

  @ApiProperty({
    description: 'Localized short summary of the problem.',
    example: 'Resource not found',
  })
  title!: string;

  @ApiProperty({
    description: 'Localized, actionable description for this request.',
    example: 'The requested resource could not be found.',
  })
  detail!: string;

  @ApiProperty({
    description: 'Stable machine-readable business code.',
    example: 'RESOURCE_NOT_FOUND',
  })
  code!: string;

  @ApiPropertyOptional({
    type: Object,
    description: 'Safe structured validation errors keyed by field or general.',
    additionalProperties: true,
  })
  errors?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Whether retrying may succeed, subject to client policy.',
    example: false,
  })
  retryable?: boolean;

  @ApiPropertyOptional({
    description: 'Minimum delay before retrying, in seconds.',
    minimum: 0,
    example: 60,
  })
  retryAfter?: number;

  @ApiPropertyOptional({
    description: 'Trace correlation identifier; never a business key.',
    example: '4bf92f3577b34da6a3ce929d0e0e4736',
  })
  traceId?: string;
}

/** Problem Details payload carried by an established SSE stream. */
export class SseProblemDetailsDto extends ProblemDetailsDto {
  @ApiProperty({
    enum: [
      'client_error',
      'server_error',
      'cancelled',
      'server_shutdown',
      'unknown',
    ],
    description: 'Why the stream ended; this is not an HTTP status code.',
  })
  status!: string;
}
