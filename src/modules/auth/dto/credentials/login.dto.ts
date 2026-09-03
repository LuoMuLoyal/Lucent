import { z } from 'zod';
import {
  emailAddressSchema,
  strongPasswordSchema,
  verificationCodeSchema,
} from '../../../../common/validators/auth.decorators.js';

/**
 * Standard Schema (zod) for `POST /auth/login` body.
 *
 * Migration notes (class-validator → zod):
 * - `@IsEmailAddress()` → `emailAddressSchema()` (zod email format + not-empty
 *   messages reused from the original validator);
 * - `@IsStrongPassword({ optional: true })` → `strongPasswordSchema().optional()`
 *   (strong password rules live in `common/validators/auth.decorators.ts`);
 * - `@IsVerificationCode({ optional: true })` → `verificationCodeSchema().optional()`
 *   (default: exactly `VERIFICATION_CODE_LENGTH` characters when present);
 * - the global `forbidNonWhitelisted` posture is preserved with `.strict()`.
 */
export const loginSchema = z
  .object({
    email: emailAddressSchema().describe('邮箱地址'),
    password: strongPasswordSchema()
      .describe('密码（与验证码二选一）')
      .optional(),
    code: verificationCodeSchema()
      .describe('邮箱验证码（与密码二选一）')
      .optional(),
  })
  .strict();

/** Strongly typed body of `POST /auth/login`. */
export type LoginDto = z.infer<typeof loginSchema>;
