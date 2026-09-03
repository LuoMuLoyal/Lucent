import { applyDecorators } from '@nestjs/common';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { z } from 'zod';

export const PASSWORD_MIN_LENGTH: number = 8;
export const PASSWORD_MAX_LENGTH: number = 32;
export const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/;
export const VERIFICATION_CODE_LENGTH = 6;

export interface IsStrongPasswordOptions {
  optional?: boolean;
  messagePrefix?: string;
  notEmptyMessage?: string;
}

export function IsStrongPassword(options: IsStrongPasswordOptions = {}) {
  const {
    optional = false,
    messagePrefix = '密码',
    notEmptyMessage = `${messagePrefix}不能为空`,
  } = options;

  const decorators = [
    IsString(),
    IsNotEmpty({ message: notEmptyMessage }),
    MinLength(PASSWORD_MIN_LENGTH, {
      message: `${messagePrefix}至少 ${String(PASSWORD_MIN_LENGTH)} 个字符`,
    }),
    MaxLength(PASSWORD_MAX_LENGTH, {
      message: `${messagePrefix}最多 ${String(PASSWORD_MAX_LENGTH)} 个字符`,
    }),
    Matches(PASSWORD_PATTERN, {
      message: `${messagePrefix}必须包含大写字母、小写字母和数字`,
    }),
  ];

  return applyDecorators(
    ...(optional ? [IsOptional(), ...decorators] : decorators),
  );
}

export interface IsEmailAddressOptions {
  optional?: boolean;
  message?: string;
  notEmptyMessage?: string;
}

export function IsEmailAddress(options: IsEmailAddressOptions = {}) {
  const {
    optional = false,
    message = '邮箱格式不正确',
    notEmptyMessage = '邮箱不能为空',
  } = options;

  const decorators = [
    IsEmail({}, { message }),
    IsNotEmpty({ message: notEmptyMessage }),
  ];

  return applyDecorators(
    ...(optional ? [IsOptional(), ...decorators] : decorators),
  );
}

// ── zod 等价规则片段(请求侧 DTO 迁移用)───────────────────────
//
// 与上方 class-validator 装饰器共用同一套常量与提示文案。工厂返回
// 单字段 zod schema,由 auth 模块各请求 DTO 的 z.object 组合使用。

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
