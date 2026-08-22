import { HttpStatus } from '@nestjs/common';
import { buildProblemDetails, problemTypeForCode } from './problem-details';

describe('problem-details', () => {
  it('builds the target Problem Details representation without HTTP duplicate fields', () => {
    const result = buildProblemDetails({
      status: HttpStatus.CONFLICT,
      code: 'RECORD_ALREADY_EXISTS',
      title: 'Record conflict',
      detail: 'A record already exists for this date.',
      retryable: false,
      traceId: 'trace-123',
    });

    expect(result).toEqual({
      type: 'https://api.lumos.example/problems/record-already-exists',
      title: 'Record conflict',
      detail: 'A record already exists for this date.',
      code: 'RECORD_ALREADY_EXISTS',
      retryable: false,
      traceId: 'trace-123',
    });
    expect(result).not.toHaveProperty('status');
    expect(result).not.toHaveProperty('statusCode');
    expect(result).not.toHaveProperty('requestId');
  });

  it('creates a stable problem URI from a machine code', () => {
    expect(problemTypeForCode('AUTH_TOKEN_EXPIRED')).toBe(
      'https://api.lumos.example/problems/auth-token-expired',
    );
  });
});
