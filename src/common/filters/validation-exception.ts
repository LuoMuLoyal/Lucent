import { BadRequestException } from '@nestjs/common';

/** One Standard Schema issue, flattened for the problem+json `errors` body. */
export interface ValidationIssue {
  /** Dotted path of the offending field, `''` for whole-body issues. */
  path: string;
  /** Schema-authored message (already localized where the schema says so). */
  message: string;
}

/**
 * 400 carrying per-field Standard Schema issues.
 *
 * `resolveErrors` in `ApiExceptionFilter` only understands a record or a
 * string-array `message`, so passing the raw issue list would drop the
 * `path` — the one field a client needs to tell "which key was rejected"
 * from "the body is malformed". This exception keeps the issues structured
 * in `errors`, which the filter forwards verbatim into the problem+json
 * body, while `message` stays a human-readable summary for logs.
 *
 * Production symptom this exists to fix: a `.strict()` body rejecting an
 * extra key reported `path: []` / `unrecognized_keys`, leaving the client
 * (and the retry queue) with no actionable field name.
 */
export class ValidationException extends BadRequestException {
  constructor(issues: readonly ValidationIssue[]) {
    super({
      statusCode: 400,
      message: ValidationException.formatMessages(issues),
      errors: { issues: issues.map((issue) => ({ ...issue })) },
    });
  }

  private static formatMessages(issues: readonly ValidationIssue[]): string[] {
    return issues.map((issue) =>
      issue.path.length > 0 ? `${issue.path}: ${issue.message}` : issue.message,
    );
  }
}
