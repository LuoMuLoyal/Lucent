import { z } from 'zod';
import { emailAddressSchema } from '../../../../common/validators/auth.decorators.js';

/**
 * Standard Schema (zod) for `POST /auth/forgot-password` body.
 *
 * Migration notes:
 * - `@IsEmailAddress()` → `emailAddressSchema()`.
 */
export const forgotPasswordSchema = z
  .object({
    email: emailAddressSchema().describe('邮箱地址'),
  })
  .strict();

/** Strongly typed body of `POST /auth/forgot-password`. */
export type ForgotPasswordDto = z.infer<typeof forgotPasswordSchema>;
