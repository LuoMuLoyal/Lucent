import { z } from 'zod';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../../../common/validators/auth.decorators.js';

/**
 * Standard Schema (zod 4) for `POST /testing/fullstack-e2e/record-lane/prepare`.
 *
 * Replaces the former class-validator DTO (test-support endpoint):
 * - `@IsEmailAddress()` → `z.email()` (invalid formats rejected; an empty
 *   string also fails the format check, matching `@IsEmail` + `@IsNotEmpty`);
 * - password uses the shared `PASSWORD_MIN_LENGTH`/`PASSWORD_MAX_LENGTH`
 *   bounds only. Strength scoring is deliberately *not* applied: this endpoint
 *   seeds fixtures with a fixed, known password, so requiring a zxcvbn score
 *   would mean rewriting the seed constant every time the scorer changes;
 * - `@Matches(/^\d{4}-\d{2}-\d{2}$/)` → same regex for the date;
 * - nickname `@MinLength/@MaxLength` → `.min/.max`;
 * - the global `forbidNonWhitelisted` behaviour is preserved with `.strict()`.
 */
export const prepareFullstackRecordLaneSchema = z
  .object({
    email: z
      .string()
      .min(1, 'validation.field.required')
      .pipe(z.email('validation.email.invalid')),
    password: z
      .string()
      .min(1, 'validation.field.required')
      .min(PASSWORD_MIN_LENGTH, 'validation.password.too_short')
      .max(PASSWORD_MAX_LENGTH, 'validation.password.too_long'),
    date: z
      .string()
      .min(1, 'validation.field.required')
      .regex(/^\d{4}-\d{2}-\d{2}$/, '日期必须是 YYYY-MM-DD'),
    nickname: z
      .string()
      .min(1, 'validation.field.required')
      .max(20, 'validation.field.too_long')
      .optional(),
  })
  .strict();

/** Strongly typed request body of the record-lane prepare endpoint. */
export type PrepareFullstackRecordLaneDto = z.infer<
  typeof prepareFullstackRecordLaneSchema
>;
