import { z } from 'zod';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_PATTERN,
} from '../../../common/validators/auth.decorators.js';

/**
 * Standard Schema (zod 4) for `POST /testing/fullstack-e2e/record-lane/prepare`.
 *
 * Replaces the former class-validator DTO (test-support endpoint):
 * - `@IsEmailAddress()` → `z.email()` (invalid formats rejected; an empty
 *   string also fails the format check, matching `@IsEmail` + `@IsNotEmpty`);
 * - `@IsStrongPassword()` → length bounds from the shared
 *   `PASSWORD_MIN_LENGTH`/`PASSWORD_MAX_LENGTH`/`PASSWORD_PATTERN` constants;
 * - `@Matches(/^\d{4}-\d{2}-\d{2}$/)` → same regex for the date;
 * - nickname `@MinLength/@MaxLength` → `.min/.max`;
 * - the global `forbidNonWhitelisted` behaviour is preserved with `.strict()`.
 */
export const prepareFullstackRecordLaneSchema = z
  .object({
    email: z.string().min(1, '邮箱不能为空').pipe(z.email('邮箱格式不正确')),
    password: z
      .string()
      .min(PASSWORD_MIN_LENGTH, '密码至少 8 个字符')
      .max(PASSWORD_MAX_LENGTH, '密码最多 32 个字符')
      .regex(PASSWORD_PATTERN, '密码必须包含大写字母、小写字母和数字'),
    date: z
      .string()
      .min(1, '日期不能为空')
      .regex(/^\d{4}-\d{2}-\d{2}$/, '日期必须是 YYYY-MM-DD'),
    nickname: z
      .string()
      .min(1, '昵称至少 1 个字符')
      .max(20, '昵称最多 20 个字符')
      .optional(),
  })
  .strict();

/** Strongly typed request body of the record-lane prepare endpoint. */
export type PrepareFullstackRecordLaneDto = z.infer<
  typeof prepareFullstackRecordLaneSchema
>;
