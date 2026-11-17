/**
 * 通知仓储端口 —— 应用层不直连 Prisma。
 *
 * 方法全部返回 Promise，失败即抛出（由用例映射成 `DomainFailure`）。
 * 「查不到」用 `null` / `count === 0` 表达，**不是**异常——那是正常结果。
 */
import type {
  NewNotification,
  NotificationRow,
  NotificationScope,
} from '../../domain/notification/notification.js';

export abstract class Notifications {
  /** 直接创建一条通知。 */
  abstract create(
    userId: string,
    input: NewNotification,
  ): Promise<NotificationRow>;

  /**
   * 幂等创建：同作用域的旧通知被替换掉。
   *
   * 两条路径由实现选择（`scopeKey` 有值走 upsert，否则按 payload 匹配），
   * 用例只表达「同一作用域只留一条」这个规则。
   */
  abstract createOrReplaceScoped(
    userId: string,
    input: NewNotification,
    scope: NotificationScope,
  ): Promise<NotificationRow>;

  /** 分页读列表（按创建时间倒序）。 */
  abstract list(
    userId: string,
    page: { page: number; pageSize: number },
  ): Promise<{ items: NotificationRow[]; total: number }>;

  /** 按 id 读一条；不属于该用户时返回 `null`（404 语义由用例给）。 */
  abstract findById(
    userId: string,
    id: string,
  ): Promise<NotificationRow | null>;

  /** 标记已读（幂等：已读的再标记不报错）。 */
  abstract markRead(userId: string, id: string): Promise<void>;

  /** 标记未读。 */
  abstract markUnread(userId: string, id: string): Promise<void>;

  /** 全部标记已读，返回受影响条数。 */
  abstract markAllRead(userId: string): Promise<number>;

  /** 删除一条；返回是否真的删掉了（`false` = 不存在或不属于该用户）。 */
  abstract remove(userId: string, id: string): Promise<boolean>;

  /** 未读数。 */
  abstract unreadCount(userId: string): Promise<number>;
}
