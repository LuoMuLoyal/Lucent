import { z } from 'zod';
import { emailAddressSchema } from '../../../../common/validators/auth.decorators.js';

export const VERIFICATION_SCENES = [
  'register',
  'login',
  'change-email',
  'set-password',
  'delete-account',
] as const;

export type VerificationScene = (typeof VERIFICATION_SCENES)[number];

/**
 * Standard Schema (zod) for `POST /auth/send-verification-code` body.
 *
 * Migration notes:
 * - `@IsEmailAddress()` → `emailAddressSchema()`;
 * - `@IsString` + `@IsNotEmpty({ message: 'scene 不能为空' })` +
 *   `@IsIn(VERIFICATION_SCENES, { message: 'scene 取值不合法' })` →
 *   `z.enum(VERIFICATION_SCENES, …)` (enum rejects missing/unknown values).
 */
export const sendVerificationCodeSchema = z
  .object({
    email: emailAddressSchema().describe('邮箱地址'),
    scene: z.enum(VERIFICATION_SCENES, {
      message: 'scene 取值不合法',
    }),
  })
  .strict();

/** Strongly typed body of `POST /auth/send-verification-code`. */
export type SendVerificationCodeDto = z.infer<
  typeof sendVerificationCodeSchema
>;
