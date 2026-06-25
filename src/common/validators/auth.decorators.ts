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

export interface IsVerificationCodeOptions {
  optional?: boolean;
  exactLength?: boolean;
}

export function IsVerificationCode(options: IsVerificationCodeOptions = {}) {
  const { optional = false, exactLength = true } = options;

  const decorators = [IsString(), IsNotEmpty({ message: '验证码不能为空' })];

  if (exactLength) {
    decorators.push(
      MinLength(VERIFICATION_CODE_LENGTH, { message: '验证码为 6 位' }),
      MaxLength(VERIFICATION_CODE_LENGTH, { message: '验证码为 6 位' }),
    );
  }

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
