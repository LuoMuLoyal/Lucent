import { z } from 'zod';

// Shared rule constants and zod fragments for auth request fields. The
// former class-validator decorators (IsStrongPassword/IsEmailAddress) were
// removed with the request-side zod migration — no remaining consumer.

export const PASSWORD_MIN_LENGTH: number = 8;
export const PASSWORD_MAX_LENGTH: number = 32;
export const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/;
export const VERIFICATION_CODE_LENGTH = 6;

export interface StrongPasswordSchemaOptions {
  messagePrefix?: string;
  notEmptyMessage?: string;
}

/**
 * 强密码字段:8-32 位且包含大小写字母和数字。
 */
export function strongPasswordSchema(
  options: StrongPasswordSchemaOptions = {},
): z.ZodString {
  const {
    messagePrefix = '密码',
    notEmptyMessage = `${messagePrefix}不能为空`,
  } = options;

  return z
    .string({ error: notEmptyMessage })
    .min(1, notEmptyMessage)
    .min(
      PASSWORD_MIN_LENGTH,
      `${messagePrefix}至少 ${String(PASSWORD_MIN_LENGTH)} 个字符`,
    )
    .max(
      PASSWORD_MAX_LENGTH,
      `${messagePrefix}最多 ${String(PASSWORD_MAX_LENGTH)} 个字符`,
    )
    .regex(
      PASSWORD_PATTERN,
      `${messagePrefix}必须包含大写字母、小写字母和数字`,
    );
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

  const base = z.string({ error: '验证码不能为空' }).min(1, '验证码不能为空');
  if (!exactLength) {
    return base;
  }
  return base.length(
    VERIFICATION_CODE_LENGTH,
    `验证码为 ${String(VERIFICATION_CODE_LENGTH)} 位`,
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
  const { message = '邮箱格式不正确', notEmptyMessage = '邮箱不能为空' } =
    options;

  return z
    .string({ error: notEmptyMessage })
    .min(1, notEmptyMessage)
    .pipe(z.email({ message }));
}
