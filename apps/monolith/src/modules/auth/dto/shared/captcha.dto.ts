import { z } from 'zod';

/**
 * Standard Schema for `GET /auth/captcha`.
 *
 * Public by design — the site key is embedded in every rendered widget anyway.
 * `enabled: false` means the deployment has no Turnstile credentials and the
 * client should skip rendering the challenge entirely.
 *
 * `example`/`nullable` metadata is required by the OpenAPI contract test
 * (`test/contract/openapi-metadata.e2e-spec.ts`): every 2xx JSON response
 * schema must carry at least one of them so generated clients still get a
 * usable shape when a field is nullable or a boolean.
 */
export const captchaSchema = z
  .object({
    enabled: z.boolean().describe('是否启用').meta({ example: false }),
    siteKey: z
      .string()
      .describe('站点密钥')
      .meta({ example: '0x4AAAAAAA_example_site_key' }),
  })
  .strict();

/** Strongly typed body of `GET /auth/captcha`. */
export type CaptchaDto = z.infer<typeof captchaSchema>;
