import { z } from 'zod';

/**
 * 会话清单的响应 schema，用于 `GET /api/v1/auth/sessions`。
 *
 * ## 为什么没有设备字段
 *
 * 早先这里有 `deviceType` / `deviceName` / `platform`，但**全仓库没有任何写入
 * 路径**——`user_sessions` 表虽然有三列，创建会话时从不写，客户端也没有上报
 * 设备信息的通道。所以它们恒为 `null`。
 *
 * 2026-10-25 从契约里删除：恒为 null 的字段会让客户端写
 * `deviceName ?? '未知设备'` 的兜底，以为「某些情况下有值」。要真做设备清单，
 * 得先让客户端上报设备信息——那是另一个需求。
 *
 * ## `isCurrent` 的语义
 *
 * 表示「这条会话是否由发起本次请求的客户端持有」。它靠请求携带的
 * `lucent_refresh` cookie 与每条会话的 `refreshTokenHash` 比对得出。
 *
 * **Bearer 客户端恒为 `false`**：它们的 refresh token 在客户端自己手里，
 * 请求里没有 refresh cookie，服务端无从比对。**这不是缺陷**——它们本来也
 * 不该依赖这个字段。不要为了「让它也能显示」去猜一个值。
 *
 * 该端点返回 JSON 数组。出站校验用 item schema（全局序列化器逐项校验），
 * 数组 schema 只用于 OpenAPI 注册。
 */

/** 单条会话。 */
export const sessionListItemSchema = z.object({
  id: z.string().describe('会话 ID'),
  lastUsedAt: z.string().nullable().describe('最近使用时间 (ISO-8601)'),
  createdAt: z.string().describe('创建时间 (ISO-8601)'),
  expiresAt: z.string().describe('过期时间 (ISO-8601)'),
  isCurrent: z
    .boolean()
    .describe('是否为发起本次请求的会话（Bearer 客户端恒为 false）'),
});

/** 单条会话的强类型。 */
export type SessionListItemDto = z.infer<typeof sessionListItemSchema>;

/** `GET /auth/sessions` 成功响应的数组 schema（仅用于 OpenAPI 注册）。 */
export const sessionListSchema = z
  .array(sessionListItemSchema)
  .describe('当前用户仍在生效的会话。');
