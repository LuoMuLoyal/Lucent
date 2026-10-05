import { z } from 'zod';

// Shared rule constants and zod fragments for auth request fields. The
// former class-validator decorators (IsStrongPassword/IsEmailAddress) were
// removed with the request-side zod migration — no remaining consumer.
//
// Schema messages are **stable codes** (`validation.password.too_short`),
// rendered in the request language by `translateValidationMessage` at the
// validation boundary. A schema is constructed at module load, so prose here
// could not follow `Accept-Language`: the previous Chinese sentences reached
// English users verbatim. `field` is interpolated, so one code covers every
// password field.

export const PASSWORD_MIN_LENGTH: number = 8;
export const PASSWORD_MAX_LENGTH: number = 32;
export const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/;
export const VERIFICATION_CODE_LENGTH = 6;

export interface StrongPasswordSchemaOptions {
  /**
   * Field label interpolated into generic messages. Kept for callers whose
   * copy differs from the password-specific codes.
   */
  messagePrefix?: string;
  /** Overrides the "required" message code (e.g. for a confirmation field). */
  notEmptyMessage?: string;
}

/**
 * 强密码字段:8-32 位且包含大小写字母和数字。
 */
export function strongPasswordSchema(
  options: StrongPasswordSchemaOptions = {},
): z.ZodString {
  const { notEmptyMessage = 'validation.field.required' } = options;

  return z
    .string({ error: notEmptyMessage })
    .min(1, notEmptyMessage)
    .min(PASSWORD_MIN_LENGTH, 'validation.password.too_short')
    .max(PASSWORD_MAX_LENGTH, 'validation.password.too_long')
    .regex(PASSWORD_PATTERN, 'validation.password.too_weak');
}

export interface VerificationCodeSchemaOptions {
  exactLength?: boolean;
}

/**
 * 邮箱验证码字段:默认为 6 位;exactLength=false 时仅要求非空。
 */
export function verificationCodeSchema(
  options: VerificationCodeSchemaOptions = {},
): z.ZodString {
  const { exactLength = true } = options;

  const base = z
    .string({ error: 'validation.field.required' })
    .min(1, 'validation.field.required');
  if (!exactLength) {
    return base;
  }
  return base.length(
    VERIFICATION_CODE_LENGTH,
    'validation.code.invalid_length',
  );
}

export interface EmailAddressSchemaOptions {
  message?: string;
  notEmptyMessage?: string;
}

/**
 * 邮箱地址字段:非空且格式正确。
 */
export function emailAddressSchema(options: EmailAddressSchemaOptions = {}) {
  const {
    message = 'validation.email.invalid',
    notEmptyMessage = 'validation.field.required',
  } = options;

  return z
    .string({ error: notEmptyMessage })
    .min(1, notEmptyMessage)
    .pipe(z.email({ message }));
}
