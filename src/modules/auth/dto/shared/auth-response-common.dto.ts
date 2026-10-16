import { z } from 'zod';

/**
 * Shared auth response schemas.
 *
 * Each schema replaces the former `@ApiProperty` response class of the same
 * name (minus the `Schema` suffix). The wire shapes (nullable user profile
 * fields etc.) are mirrored exactly; examples are not migrated (see the zod
 * migration TODO for example/nullable metadata completion).
 */

/** Replaces `UserBriefDto` — 注册/简略用户信息. */
export const userBriefSchema = z.object({
  id: z.string().describe('用户 ID'),
  email: z.string().nullable().describe('邮箱地址，第三方账号可能为空'),
  nickname: z.string().nullable().describe('昵称'),
  emailVerified: z.boolean().describe('邮箱是否已验证'),
  emailVerifiedAt: z.string().nullable().describe('邮箱验证时间 (ISO 8601)'),
  createdAt: z.string().describe('创建时间 (ISO 8601)'),
});

/** Strongly typed brief user block of the auth responses. */
export type UserBriefDto = z.infer<typeof userBriefSchema>;

/** Replaces `UserFullDto` — 登录/完整用户信息. */
export const userFullSchema = z.object({
  id: z.string().describe('用户 ID'),
  email: z.string().nullable().describe('邮箱地址，第三方账号可能为空'),
  nickname: z.string().nullable().describe('昵称'),
  avatar: z.string().nullable().describe('头像 URL'),
  emailVerified: z.boolean().describe('邮箱是否已验证'),
  emailVerifiedAt: z.string().nullable().describe('邮箱验证时间 (ISO 8601)'),
  createdAt: z.string().describe('创建时间 (ISO 8601)'),
  updatedAt: z.string().describe('更新时间 (ISO 8601)'),
});

/** Strongly typed full user block of the auth responses. */
export type UserFullDto = z.infer<typeof userFullSchema>;

/** Replaces `TokensDto` — 令牌信息. */
export const tokensSchema = z.object({
  accessToken: z.string().describe('访问令牌').meta({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c3JfMSJ9',
  }),
  refreshToken: z
    .string()
    .describe('刷新令牌')
    .meta({ example: 'rt_9f8c7b6a5d4e3f2a1b0c9d8e7f6a5b4c' }),
  expiresIn: z
    .number()
    .describe('访问令牌过期时间（秒）')
    .meta({ example: 900 }),
});

/** Strongly typed token pair of the auth responses. */
export type TokensDto = z.infer<typeof tokensSchema>;

/** Replaces `CooldownMessageDto` — 冷却时间 + 提示消息. */
export const cooldownMessageSchema = z.object({
  cooldown: z.number().describe('冷却时间（秒）').meta({ example: 60 }),
  message: z
    .string()
    .describe('提示消息')
    .meta({ example: '验证码已发送，请注意查收' }),
});

/** Strongly typed cooldown + message block of the auth responses. */
export type CooldownMessageDto = z.infer<typeof cooldownMessageSchema>;
