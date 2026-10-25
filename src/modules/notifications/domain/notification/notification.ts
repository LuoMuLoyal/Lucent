/**
 * 通知的领域概念 —— 薄聚合。
 *
 * ## 为什么这个聚合值得存在（而不是直接读写行）
 *
 * 通知有一条真实的业务规则：**同一 `{userId, type, scopeKey}` 的通知应当被
 * 替换而不是重复插入**（`createOrReplaceScoped`）。这条规则有跨行语义
 * （先查重复再写），且有两个实现路径（`scopeKey` 走唯一约束 upsert、
 * 无 `scopeKey` 走 `actionPayload` 匹配后删除再建）。把它放在 use case 里写
 * 会退化成「一堆 Prisma 调用」；放在这里可以独立测。
 *
 * 其余操作（读列表、标记已读、删除）确实是「查库 + 拼 DTO」，不建领域模型。
 */

/** 通知的作用域元数据 —— 幂等替换的依据。 */
export interface NotificationScope {
  /** 来源标识（如 `today-suggestion`）。 */
  source: string;
  /** 业务日期（`YYYY-MM-DD`）。 */
  date: string;
  /**
   * 可选的显式作用域键。
   *
   * 有值时走唯一约束 `(userId, type, scopeKey)` 的 upsert——**最快的路径**，
   * 由数据库保证唯一性。没有值时退回「按 `actionPayload` 里的
   * `{source,date}` 匹配已有行、删掉再插」。
   */
  scopeKey?: string;
}

/** 一条通知（读侧形状）。 */
export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  content: string;
  action: string | null;
  actionPayload: unknown;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
}

/** 创建通知的输入。 */
export interface NewNotification {
  type: string;
  title: string;
  content: string;
  action?: string | null | undefined;
  actionPayload?: unknown;
}

/**
 * 判断一条已有通知的 payload 是否属于同一作用域。
 *
 * `actionPayload` 是历史遗留的 JSON 列，形状不确定：可能是单个对象，也可能
 * 是对象数组（一次事件带多条）。两种都要认，且**只比 `source` 与 `date`**
 * ——`scopeKey` 不在这里比，它是数据库唯一约束那一路的输入。
 *
 * 这个函数是纯的，所以能独立测——这正是把它放进 `domain/` 的理由。
 */
export function matchesScope(
  payload: unknown,
  scope: Pick<NotificationScope, 'source' | 'date'>,
): boolean {
  const sameScope = (candidate: unknown): boolean =>
    typeof candidate === 'object' &&
    candidate !== null &&
    !Array.isArray(candidate) &&
    typeof (candidate as Record<string, unknown>)['source'] === 'string' &&
    typeof (candidate as Record<string, unknown>)['date'] === 'string' &&
    (candidate as Record<string, unknown>)['source'] === scope.source &&
    (candidate as Record<string, unknown>)['date'] === scope.date;

  if (payload == null) return false;
  if (Array.isArray(payload)) return payload.some(sameScope);
  return sameScope(payload);
}
