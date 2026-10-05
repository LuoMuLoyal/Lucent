import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_PATTERN,
  VERIFICATION_CODE_LENGTH,
  strongPasswordSchema,
  verificationCodeSchema,
  emailAddressSchema,
} from './auth.decorators.js';

/**
 * These schemas emit **stable codes**, not sentences: a schema is constructed
 * at module load, so prose here could not follow `Accept-Language`.
 * `validation-copy.spec.ts` covers the rendering; this spec covers which code
 * each rule produces.
 */
describe('auth decorators constants', () => {
  it('exports correct password length limits', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(PASSWORD_MAX_LENGTH).toBe(32);
  });

  it('exports correct verification code length', () => {
    expect(VERIFICATION_CODE_LENGTH).toBe(6);
  });

  it('exports password pattern requiring upper, lower, and digit', () => {
    expect(PASSWORD_PATTERN.test('Abc12345')).toBe(true);
    expect(PASSWORD_PATTERN.test('abc12345')).toBe(false);
    expect(PASSWORD_PATTERN.test('ABC12345')).toBe(false);
    expect(PASSWORD_PATTERN.test('Abcdefgh')).toBe(false);
  });
});

/** Reads the first issue message, failing loudly when the parse succeeded. */
function firstIssueMessage(result: {
  success: boolean;
  error?: { issues: Array<{ message: string }> };
}): string {
  const message = result.error?.issues[0]?.message;
  if (message == null) throw new Error('expected a schema issue');
  return message;
}

describe('strongPasswordSchema', () => {
  it('passes for a valid password', () => {
    expect(strongPasswordSchema().safeParse('ValidPass123').success).toBe(true);
  });

  it('fails for password shorter than minimum length', () => {
    const result = strongPasswordSchema().safeParse('Ab1');
    expect(result.success).toBe(false);
    expect(firstIssueMessage(result)).toBe('validation.password.too_short');
  });

  it('fails for password exceeding maximum length', () => {
    const result = strongPasswordSchema().safeParse(
      `Aa1${'x'.repeat(PASSWORD_MAX_LENGTH)}`,
    );
    expect(result.success).toBe(false);
    expect(firstIssueMessage(result)).toBe('validation.password.too_long');
  });

  it('reports too_weak for a password missing the required character classes', () => {
    for (const password of ['validpass123', 'VALIDPASS123', 'ValidPassword']) {
      const result = strongPasswordSchema().safeParse(password);
      expect(result.success, password).toBe(false);
      expect(firstIssueMessage(result), password).toBe(
        'validation.password.too_weak',
      );
    }
  });

  it('reports the required code for an empty password', () => {
    const result = strongPasswordSchema().safeParse('');
    expect(result.success).toBe(false);
    expect(firstIssueMessage(result)).toBe('validation.field.required');
  });

  it('allows undefined when wrapped optional', () => {
    const schema = strongPasswordSchema().optional();
    expect(schema.safeParse(undefined).success).toBe(true);
  });

  it('lets a caller override the required code', () => {
    // Confirmation fields need their own copy ("passwords do not match").
    const result = strongPasswordSchema({
      notEmptyMessage: 'validation.field.required',
    }).safeParse('');
    expect(result.success).toBe(false);
    expect(firstIssueMessage(result)).toBe('validation.field.required');
  });
});

describe('verificationCodeSchema', () => {
  it('passes for a 6-char code', () => {
    expect(verificationCodeSchema().safeParse('123456').success).toBe(true);
  });

  it('fails for code shorter than 6 chars', () => {
    const result = verificationCodeSchema().safeParse('12345');
    expect(result.success).toBe(false);
    expect(firstIssueMessage(result)).toBe('validation.code.invalid_length');
  });

  it('fails for code longer than 6 chars', () => {
    expect(verificationCodeSchema().safeParse('1234567').success).toBe(false);
  });

  it('reports the required code for an empty code', () => {
    const result = verificationCodeSchema().safeParse('');
    expect(result.success).toBe(false);
    expect(firstIssueMessage(result)).toBe('validation.field.required');
  });

  it('allows undefined when wrapped optional', () => {
    const schema = verificationCodeSchema().optional();
    expect(schema.safeParse(undefined).success).toBe(true);
  });

  it('accepts any non-empty string when exactLength is false', () => {
    const schema = verificationCodeSchema({ exactLength: false });
    expect(schema.safeParse('abc').success).toBe(true);
  });

  it('rejects empty string when exactLength is false', () => {
    const schema = verificationCodeSchema({ exactLength: false });
    expect(schema.safeParse('').success).toBe(false);
  });
});

describe('emailAddressSchema', () => {
  it('passes for a valid email', () => {
    expect(emailAddressSchema().safeParse('user@example.com').success).toBe(
      true,
    );
  });

  it('reports email.invalid for a malformed address', () => {
    const result = emailAddressSchema().safeParse('not-an-email');
    expect(result.success).toBe(false);
    expect(firstIssueMessage(result)).toBe('validation.email.invalid');
  });

  it('reports the required code for an empty email', () => {
    const result = emailAddressSchema().safeParse('');
    expect(result.success).toBe(false);
    expect(firstIssueMessage(result)).toBe('validation.field.required');
  });

  it('allows undefined when wrapped optional', () => {
    const schema = emailAddressSchema().optional();
    expect(schema.safeParse(undefined).success).toBe(true);
  });
});
