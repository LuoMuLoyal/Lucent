import { z } from 'zod';

/**
 * Standard Schema for `GET /auth/captcha`.
 *
 * Public by design — the site key is embedded in every rendered widget anyway.
 * `enabled: false` means the deployment has no Turnstile credentials and the
 * client should skip rendering the challenge entirely.
 */
export const captchaSchema = z
  .object({
    enabled: z.boolean().describe('是否启用'),
    siteKey: z.string().describe('站点密钥'),
  })
  .strict();

/** Strongly typed body of `GET /auth/captcha`. */
export type CaptchaDto = z.infer<typeof captchaSchema>;
