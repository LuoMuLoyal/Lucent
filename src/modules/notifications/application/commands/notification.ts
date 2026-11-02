/**
 * 通知的应用层形状 —— 不复用 HTTP 层的 zod 输出类型。
 *
 * `application/` 不得依赖 `adapters/`（`arch:check` 会拦）。投递层把这个形状
 * 直接序列化（zod schema 在 `adapters/http/dto/response.ts` 里做校验与
 * OpenAPI 注册），两边字段必须一致——由 schema 测试守。
 */

/** 列表项。 */
export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  content: string;
  action: string | null;
  actionPayload: unknown;
  isRead: boolean;
  createdAt: string;
}

/** 详情 = 列表项 + 已读时间。 */
export interface NotificationDetail extends NotificationItem {
  readAt: string | null;
}
