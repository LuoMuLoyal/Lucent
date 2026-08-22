export interface ProblemDetails {
  type: string;
  title: string;
  detail: string;
  code: string;
  errors?: Record<string, unknown>;
  retryable?: boolean;
  retryAfter?: number;
  traceId?: string;
}

export interface BuildProblemDetailsInput {
  status: number;
  code: string;
  title?: string;
  detail: string;
  type?: string;
  errors?: Record<string, unknown>;
  retryable?: boolean;
  retryAfter?: number;
  traceId?: string;
}

const PROBLEM_BASE_URI = 'https://api.lumos.example/problems';

export function problemTypeForCode(code: string): string {
  return `${PROBLEM_BASE_URI}/${code
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()}`;
}

export function buildProblemDetails(
  input: BuildProblemDetailsInput,
): ProblemDetails {
  const body: ProblemDetails = {
    type: input.type ?? problemTypeForCode(input.code),
    title: input.title ?? titleForStatus(input.status),
    detail: input.detail,
    code: input.code,
  };

  if (input.errors != null) body.errors = input.errors;
  if (input.retryable != null) body.retryable = input.retryable;
  if (input.retryAfter != null) body.retryAfter = input.retryAfter;
  if (input.traceId != null && input.traceId.length > 0) {
    body.traceId = input.traceId;
  }
  return body;
}

export function titleForStatus(status: number): string {
  switch (status) {
    case 400:
      return 'Bad request';
    case 401:
      return 'Authentication required';
    case 403:
      return 'Forbidden';
    case 404:
      return 'Resource not found';
    case 409:
      return 'Conflict';
    case 429:
      return 'Too many requests';
    default:
      return status >= 500 ? 'Internal server error' : 'Request failed';
  }
}
