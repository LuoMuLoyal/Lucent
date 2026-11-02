import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
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
    expect(PASSWORD_MAX_LENGTH).toBe(128);
  });

  it('exports correct verification code length', () => {
    expect(VERIFICATION_CODE_LENGTH).toBe(6);
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
  it('passes for a long passphrase', () => {
    // The point of dropping the character-class regex: a passphrase with no
    // digits or uppercase letters is accepted when it is genuinely unguessable.
    expect(
      strongPasswordSchema().safeParse('correct horse battery staple').success,
    ).toBe(true);
  });

  it('passes for a random-looking password', () => {
    expect(strongPasswordSchema().safeParse('x9$Kp2!mQz7#Lw').success).toBe(
      true,
    );
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

  it('reports too_weak for guessable passwords that satisfy the old regex', () => {
    // Every one of these passed the previous "upper + lower + digit" rule.
    // They are exactly what strength scoring exists to catch.
    for (const password of [
      'Password1',
      'Abcd1234',
      'Qwerty123',
      'ValidPass123',
    ]) {
      const result = strongPasswordSchema().safeParse(password);
      expect(result.success, password).toBe(false);
      expect(firstIssueMessage(result), password).toBe(
        'validation.password.too_weak',
      );
    }
  });

  it('reports too_weak for common words without numbers', () => {
    for (const password of ['password', 'abcdefgh', 'qwertyui']) {
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

  it('rejects a stored-password-shaped value at login too', () => {
    // Login and password setup share this schema: weak existing passwords are
    // not grandfathered, they fail and the account must reset.
    for (const password of ['Password1', 'password', 'Abcd1234']) {
      const result = strongPasswordSchema().optional().safeParse(password);
      expect(result.success, password).toBe(false);
      expect(firstIssueMessage(result), password).toBe(
        'validation.password.too_weak',
      );
    }
  });
});

describe('verificationCodeSchema', () => {
  it('passes for a 6-char code', () => {
    expect(verificationCodeSchema().safeParse('123456').success).toBe(true);
  });

  it('accepts the full 4-8 digit range the service may issue', () => {
    expect(verificationCodeSchema().safeParse('1234').success).toBe(true);
    expect(verificationCodeSchema().safeParse('12345678').success).toBe(true);
  });

  it('fails for code shorter than 4 chars', () => {
    const result = verificationCodeSchema().safeParse('123');
    expect(result.success).toBe(false);
    expect(firstIssueMessage(result)).toBe('validation.code.invalid_length');
  });

  it('fails for code longer than 8 chars', () => {
    expect(verificationCodeSchema().safeParse('123456789').success).toBe(false);
  });

  it('fails for non-digit characters', () => {
    expect(verificationCodeSchema().safeParse('12a456').success).toBe(false);
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
