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

describe('strongPasswordSchema', () => {
  it('passes for a valid password', () => {
    expect(strongPasswordSchema().safeParse('ValidPass123').success).toBe(true);
  });

  it('fails for password shorter than minimum length', () => {
    expect(strongPasswordSchema().safeParse('Ab1').success).toBe(false);
  });

  it('fails for password exceeding maximum length', () => {
    expect(
      strongPasswordSchema().safeParse(`Aa1${'x'.repeat(PASSWORD_MAX_LENGTH)}`)
        .success,
    ).toBe(false);
  });

  it('fails for password without uppercase letter', () => {
    expect(strongPasswordSchema().safeParse('validpass123').success).toBe(
      false,
    );
  });

  it('fails for password without lowercase letter', () => {
    expect(strongPasswordSchema().safeParse('VALIDPASS123').success).toBe(
      false,
    );
  });

  it('fails for password without digit', () => {
    expect(strongPasswordSchema().safeParse('ValidPassword').success).toBe(
      false,
    );
  });

  it('fails for empty password', () => {
    const result = strongPasswordSchema().safeParse('');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('密码不能为空');
    }
  });

  it('allows undefined when wrapped optional', () => {
    const schema = strongPasswordSchema().optional();
    expect(schema.safeParse(undefined).success).toBe(true);
  });

  it('uses custom message prefix in error messages', () => {
    const result = strongPasswordSchema({ messagePrefix: '新密码' }).safeParse(
      'short',
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('新密码');
    }
  });
});

describe('verificationCodeSchema', () => {
  it('passes for a 6-char code', () => {
    expect(verificationCodeSchema().safeParse('123456').success).toBe(true);
  });

  it('fails for code shorter than 6 chars', () => {
    expect(verificationCodeSchema().safeParse('12345').success).toBe(false);
  });

  it('fails for code longer than 6 chars', () => {
    expect(verificationCodeSchema().safeParse('1234567').success).toBe(false);
  });

  it('fails for empty code', () => {
    const result = verificationCodeSchema().safeParse('');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('验证码不能为空');
    }
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

  it('fails for invalid email format', () => {
    const result = emailAddressSchema().safeParse('not-an-email');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('邮箱格式不正确');
    }
  });

  it('fails for empty email', () => {
    const result = emailAddressSchema().safeParse('');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('邮箱不能为空');
    }
  });

  it('allows undefined when wrapped optional', () => {
    const schema = emailAddressSchema().optional();
    expect(schema.safeParse(undefined).success).toBe(true);
  });
});
