import { z } from 'zod';

/**
 * Standard Schema (zod) request-side equivalents for the former
 * class-validator OAuth request DTOs in this file.
 *
 * Migration notes:
 * - `@IsString` → `z.string()`;
 * - `@MaxLength(n)` → `.max(n, …)`;
 * - `@IsOptional` → field `.optional()`;
 * - authorize DTOs are used as optional bodies (`@Body() dto?: …`), so their
 *   object schema is wrapped with `.optional()` to keep the pre-migration
 *   behaviour of accepting an absent request body;
 * - `.strict()` preserves the previous `forbidNonWhitelisted` posture.
 */

// ── authorize 请求体(callbackUri 可选,body 可缺省)────────────────

/** Standard Schema for `POST /auth/oauth/wechat-web/authorize` body. */
export const oauthAuthorizeSchema = z
  .object({
    callbackUri: z
      .string()
      .max(2048, 'validation.field.too_long')
      .describe(
        '授权完成后的客户端回跳地址。桌面端支持 loopback 地址，Web 端支持可信 CORS origin 下的 /login/oauth/wechat。',
      )
      .optional(),
  })
  .strict()
  .optional();

/** Strongly typed body of `POST /auth/oauth/wechat-web/authorize`. */
export type OAuthAuthorizeDto = z.infer<typeof oauthAuthorizeSchema>;

/** Standard Schema for `POST /auth/oauth/qq/authorize` body. */
export const qqOAuthAuthorizeSchema = z
  .object({
    callbackUri: z
      .string()
      .max(2048, 'validation.field.too_long')
      .describe('QQ 授权完成后的客户端回跳地址')
      .optional(),
  })
  .strict()
  .optional();

/** Strongly typed body of `POST /auth/oauth/qq/authorize`. */
export type QqOAuthAuthorizeDto = z.infer<typeof qqOAuthAuthorizeSchema>;

/** Standard Schema for `POST /auth/oauth/google/authorize` body. */
export const googleOAuthAuthorizeSchema = z
  .object({
    callbackUri: z
      .string()
      .max(2048, 'validation.field.too_long')
      .describe('Google 授权完成后的客户端回跳地址')
      .optional(),
  })
  .strict()
  .optional();

/** Strongly typed body of `POST /auth/oauth/google/authorize`. */
export type GoogleOAuthAuthorizeDto = z.infer<
  typeof googleOAuthAuthorizeSchema
>;

// ── callback 请求体(code/state 必填)────────────────────────────

/** Shared Standard Schema for code + state OAuth callbacks. */
const oauthCodeState = z.object({
  code: z
    .string()
    .max(512, 'validation.field.too_long')
    .describe('OAuth 授权码'),
  state: z
    .string()
    .max(512, 'validation.field.too_long')
    .describe('授权时生成的 state'),
});

/**
 * Standard Schema for `POST/GET /auth/oauth/wechat-web/callback`
 * (POST body and GET query share the code + state shape).
 */
export const oauthCallbackSchema = oauthCodeState.strict();

/** Strongly typed body/query of `POST/GET /auth/oauth/wechat-web/callback`. */
export type OAuthCallbackDto = z.infer<typeof oauthCallbackSchema>;

/** Standard Schema for `POST /auth/oauth/wechat-mobile/callback` body. */
export const oauthCodeCallbackSchema = z
  .object({
    code: z
      .string()
      .max(512, 'validation.field.too_long')
      .describe('OAuth 授权码'),
  })
  .strict();

/** Strongly typed body of `POST /auth/oauth/wechat-mobile/callback`. */
export type OAuthCodeCallbackDto = z.infer<typeof oauthCodeCallbackSchema>;

/** Standard Schema for `POST /auth/oauth/apple/callback` body. */
export const appleOAuthCallbackSchema = z
  .object({
    identityToken: z
      .string()
      .max(4096, 'validation.field.too_long')
      .describe('Apple 登录返回的 identityToken (JWT)'),
    authorizationCode: z
      .string()
      .max(1024, 'validation.field.too_long')
      .describe('Apple 登录返回的 authorizationCode（可选）')
      .optional(),
    givenName: z
      .string()
      .max(256, 'validation.field.too_long')
      .describe('Apple 返回的 givenName（首次登录时返回）')
      .optional(),
    familyName: z
      .string()
      .max(256, 'validation.field.too_long')
      .describe('Apple 返回的 familyName（首次登录时返回）')
      .optional(),
  })
  .strict();

/** Strongly typed body of `POST /auth/oauth/apple/callback`. */
export type AppleOAuthCallbackDto = z.infer<typeof appleOAuthCallbackSchema>;

/** Standard Schema for `POST /auth/oauth/qq/callback` body. */
export const qqOAuthCallbackSchema = oauthCodeState.strict();

/** Strongly typed body of `POST /auth/oauth/qq/callback`. */
export type QqOAuthCallbackDto = z.infer<typeof qqOAuthCallbackSchema>;

/** Standard Schema for `POST /auth/oauth/google/callback` body. */
export const googleOAuthCallbackSchema = oauthCodeState.strict();

/** Strongly typed body of `POST /auth/oauth/google/callback`. */
export type GoogleOAuthCallbackDto = z.infer<typeof googleOAuthCallbackSchema>;
