import { z } from 'zod';
import {
  cooldownMessageSchema,
  tokensSchema,
  userBriefSchema,
  userFullSchema,
} from './auth-response-common.dto.js';

/**
 * Auth endpoint response schemas (register / login / refresh / OAuth /
 * verification-code flows).
 *
 * Each schema replaces the former `@ApiProperty` response class of the same
 * name (minus the `Schema` suffix). Wire shapes mirror the old classes: the
 * register response carries a brief user block, the login/OAuth responses a
 * full user block, and refresh / verification-code endpoints reuse the shared
 * tokens / cooldown+message shapes.
 */

/** Replaces the private `RegisterDataDto` + exported `RegisterResponseDto`. */
export const registerResponseSchema = z.object({
  user: userBriefSchema,
  tokens: tokensSchema,
});

/** Strongly typed register response body. */
export type RegisterResponseDto = z.infer<typeof registerResponseSchema>;

/** Replaces the private `LoginDataDto` + exported `LoginResponseDto`. */
export const loginResponseSchema = z.object({
  user: userFullSchema,
  tokens: tokensSchema,
});

/** Strongly typed login / OAuth-callback response body. */
export type LoginResponseDto = z.infer<typeof loginResponseSchema>;

/** Replaces the private `OAuthAuthorizeDataDto` + exported `OAuthAuthorizeResponseDto`. */
export const oauthAuthorizeResponseSchema = z.object({
  authorizeUrl: z.string().describe('第三方授权地址'),
  state: z.string().describe('本次授权 state'),
  expiresIn: z.number().describe('state 过期时间（秒）'),
  callbackUri: z
    .string()
    .optional()
    .describe('客户端回跳地址。桌面端 loopback 或可信 Web 回调登录时返回。'),
});

/** Strongly typed OAuth authorize response body. */
export type OAuthAuthorizeResponseDto = z.infer<
  typeof oauthAuthorizeResponseSchema
>;

/**
 * Response schema of the refresh endpoint — wire-identical to
 * {@link tokensSchema}. Replaces the former response class
 * `RefreshResponseDto` (which extended `TokensDto` without adding fields).
 */
export const refreshResponseSchema = tokensSchema;

/** Strongly typed refresh token response body. */
export type RefreshResponseDto = z.infer<typeof refreshResponseSchema>;

/**
 * Response schema of the send-verification-code endpoint — wire-identical to
 * {@link cooldownMessageSchema}. Replaces the former response class
 * `SendVerificationCodeResponseDto` (which extended `CooldownMessageDto`
 * without adding fields).
 */
export const sendVerificationCodeResponseSchema = cooldownMessageSchema;

/** Strongly typed send-verification-code response body. */
export type SendVerificationCodeResponseDto = z.infer<
  typeof sendVerificationCodeResponseSchema
>;

/** Replaces the private `VerifyEmailDataDto` + exported `VerifyEmailResponseDto`. */
export const verifyEmailResponseSchema = z.object({
  emailVerified: z.boolean().describe('邮箱是否已验证'),
});

/** Strongly typed verify-email response body. */
export type VerifyEmailResponseDto = z.infer<typeof verifyEmailResponseSchema>;

/**
 * Response schema of the forgot-password endpoint — wire-identical to
 * {@link cooldownMessageSchema}. Replaces the former response class
 * `ForgotPasswordResponseDto` (which extended `CooldownMessageDto` without
 * adding fields).
 */
export const forgotPasswordResponseSchema = cooldownMessageSchema;

/** Strongly typed forgot-password response body. */
export type ForgotPasswordResponseDto = z.infer<
  typeof forgotPasswordResponseSchema
>;
