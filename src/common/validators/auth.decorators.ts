import { z } from 'zod';

import { assessPasswordStrength } from './password-strength.js';

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
/**
 * Upper bound is deliberately loose: it exists to bound hashing cost, not to
 * shape the password. The former bound of 32 was short enough to reject
 * passphrases, which are the one password style strength scoring recommends.
 */
export const PASSWORD_MAX_LENGTH: number = 128;
/**
 * Default code length. `VERIFICATION_CODE_LENGTH` is what the service issues
 * when `VERIFICATION_CODE_LENGTH` is unpublished; the accepted range below is
 * what the request schemas validate, because the length is a runtime-config
 * hot key and a schema is built at module load.
 */
export const VERIFICATION_CODE_LENGTH = 6;
export const VERIFICATION_CODE_MIN_LENGTH: number = 4;
export const VERIFICATION_CODE_MAX_LENGTH: number = 8;

/**
 * Turnstile 响应令牌长度上限。Cloudflare 的令牌约 2 KB,这里只是防止客户端
 * 发送无界字符串。
 */
export const CAPTCHA_TOKEN_MAX_LENGTH: number = 4096;

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
 * 密码字段:至少 8 位,且 zxcvbn 强度评分不低于 `PASSWORD_MIN_SCORE`。
 *
 * 强度判定不再用字符类正则。正则只看字符构成、不看是否可猜,
 * 结果是 `Password1` 通过而 `correct horse battery staple` 被拒——正好与目的相反。
 * 评分规则见 `password-strength.ts`。
 *
 * 本 schema 同时用于登录与设密。对存量弱密码一律拒绝,不做兼容:
 * 存量用户的旧密码不再能登录,需走「忘记密码」重设。
 *
 * 评分不掺入用户上下文(userInputs):schema 在模块加载时构造,那时并不知道
 * 请求里的邮箱或昵称。需要上下文评分的调用方直接用 `assessPasswordStrength`。
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
    .refine(
      (value) => assessPasswordStrength(value).accepted,
      'validation.password.too_weak',
    );
}

export interface VerificationCodeSchemaOptions {
  exactLength?: boolean;
}

/**
 * 邮箱验证码字段:默认要求 4-8 位数字(线上默认 6 位,长度本身是运行时热键);
 * exactLength=false 时仅要求非空。
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
  return base.regex(
    new RegExp(
      `^[0-9]{${String(VERIFICATION_CODE_MIN_LENGTH)},${String(VERIFICATION_CODE_MAX_LENGTH)}}$`,
      'u',
    ),
    'validation.code.invalid_length',
  );
}

/**
 * 人机验证令牌字段(Cloudflare Turnstile 的 `cf-turnstile-response`)。
 *
 * schema 层只约束取值范围,**不**约束是否必填:是否强制由运行时决定——
 * 未配置凭据时整体关闭;登录侧仅在失败次数越过阈值后才要求。缺令牌时由
 * 校验服务返回 `AUTH_CAPTCHA_REQUIRED`,schema 不参与该判断。
 */
export function captchaTokenSchema() {
  return z
    .string()
    .min(1, 'validation.field.required')
    .max(CAPTCHA_TOKEN_MAX_LENGTH, 'validation.field.too_long')
    .optional();
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
