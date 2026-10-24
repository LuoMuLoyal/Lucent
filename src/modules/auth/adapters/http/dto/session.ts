import { z } from 'zod';
import {
  captchaTokenSchema,
  emailAddressSchema,
  strongPasswordSchema,
  verificationCodeSchema,
} from '../../../../../common/validators/auth.decorators.js';

/** 默认 access token TTL（秒），仅用于 OpenAPI 示例值，不参与校验。 */
const ACCESS_TTL_EXAMPLE_SECONDS = 900;

/** 昵称长度上限。与 User.nickname 的展示宽度对齐，不塑造语义。 */
const NICKNAME_MAX_LENGTH = 20;

/**
 * HTTP 契约：httpOnly cookie 会话（`/auth/sessions/*`）。账户资料读走 `GET /account`。
 *
 * ## 与 Bearer 契约的关系
 *
 * Bearer 那条路（`/auth/login`、`/auth/register`）把 token 放进响应体，
 * 由客户端自己保管——手机端依赖它，**不动**。
 *
 * 这里提供同一套凭据校验的另一条出口：**响应体里没有 `tokens`**，
 * token 只经 `Set-Cookie` 下发。两者共用 `AuthService` 的校验逻辑，
 * 差别只在签发后的落点。
 *
 * ## 请求侧字段为什么与 Bearer 版一模一样
 *
 * 凭据就是凭据，没有第二种语义。分成两份 schema 而不是复用，是因为两者的
 * **响应承诺**不同（这里承诺「不返回 token」），将来分别演进时不该互相牵连。
 */

/** 登录请求。密码与验证码二选一。 */
export const sessionLoginSchema = z
  .object({
    email: emailAddressSchema().describe('邮箱地址'),
    password: strongPasswordSchema()
      .describe('密码（与验证码二选一）')
      .optional(),
    code: verificationCodeSchema()
      .describe('邮箱验证码（与密码二选一）')
      .optional(),
    captchaToken: captchaTokenSchema().describe('人机验证令牌'),
  })
  .strict();

export type SessionLoginDto = z.infer<typeof sessionLoginSchema>;

/**
 * 注册请求。`code` 必填——服务端注册流程要求邮箱验证码，
 * 客户端必须先调 `POST /auth/send-verification-code`（`scene: 'register'`）。
 */
export const sessionRegisterSchema = z
  .object({
    email: emailAddressSchema().describe('邮箱地址'),
    password:
      strongPasswordSchema().describe('密码（至少8位，需通过强度校验）'),
    code: verificationCodeSchema({ exactLength: false }).describe('邮箱验证码'),
    captchaToken: captchaTokenSchema().describe('人机验证令牌'),
    nickname: z
      .string()
      .min(1, 'validation.field.required')
      .max(NICKNAME_MAX_LENGTH, 'validation.field.too_long')
      .describe('昵称')
      .optional(),
  })
  .strict();

export type SessionRegisterDto = z.infer<typeof sessionRegisterSchema>;

/**
 * 会话建立时返回的用户资料块。
 *
 * 账户资料的**唯一读入口**是 `GET /account`；这里的 `user` 只是「会话建立」
 * 的产物。两处不合并字段——`hasPassword` 要额外查一次 `account` 表，
 * 登录响应不该为一个布尔位多打一次库。
 *
 * 字段是 `AccountDto` 的**子集**（`email` / `nickname` / `avatar` /
 * `emailVerifiedAt` / `createdAt` / `updatedAt`），外加 `emailVerified`
 * 这个供登录态直接判断的布尔位。
 */
export const sessionUserSchema = z.object({
  id: z.string().describe('用户 ID'),
  email: z.string().describe('邮箱地址'),
  nickname: z.string().nullable().describe('昵称'),
  avatar: z.string().nullable().describe('头像 URL'),
  emailVerified: z.boolean().describe('邮箱是否已验证'),
  emailVerifiedAt: z.string().nullable().describe('邮箱验证时间 (ISO 8601)'),
  createdAt: z.string().describe('创建时间 (ISO 8601)'),
  updatedAt: z.string().describe('更新时间 (ISO 8601)'),
});

export type SessionUserDto = z.infer<typeof sessionUserSchema>;

/**
 * 建立 / 轮换会话的响应。
 *
 * `expiresIn` 是 access token 的剩余秒数，供前端安排静默刷新；
 * cookie 自身的有效期由 `Set-Cookie` 的 `Max-Age` 决定。
 */
export const sessionResponseSchema = z.object({
  user: sessionUserSchema,
  expiresIn: z
    .number()
    .describe('访问令牌过期时间（秒）')
    .meta({ example: ACCESS_TTL_EXAMPLE_SECONDS }),
});

export type SessionResponseDto = z.infer<typeof sessionResponseSchema>;
