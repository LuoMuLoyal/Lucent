/**
 * 产品事件的写入端口 —— 应用层不直连 Prisma。
 *
 * ## 为什么这个端口只有两件事
 *
 * 测点存储是**只写**的（隐私最小化：枚举 + 有界属性，无 JSON、无自由文本），
 * 请求路径上不做聚合。所以端口只需要「批量写入」与「一次 SQL 聚合」。
 *
 * ## 幂等在哪
 *
 * `insertBatch` 依赖 `(userId, clientEventId)` 唯一约束 + `skipDuplicates`：
 * 客户端重试与批内重复会**静默跳过**而不是双写。这条语义在端口契约里写明，
 * 因为它决定了 `recorded < received` 是正常结果，不是错误。
 */
/** 一行待写入的事件（已通过用例的边界校验）。 */
export interface ProductEventRow {
  userId: string;
  clientEventId: string;
  name: string;
  surface: string;
  result: string;
  eventStatus: string | null;
  suggestionRuleCode: string | null;
  appVersion: string;
  platform: string;
  occurredAt: Date;
}

/** 聚合查询的一行：某天、某事件的计数。 */
export interface FunnelAggregateRow {
  day: string;
  name: string;
  count: number;
}

/** 聚合查询的时间窗（`[start, end)`）。 */
export interface FunnelWindow {
  start: Date;
  end: Date;
}

export abstract class ProductEvents {
  /**
   * 批量写入，返回实际插入的行数。
   *
   * 重复的 `clientEventId` 被静默跳过（唯一约束 + skipDuplicates），
   * 所以返回值可能小于输入长度——**那是正常结果**。
   */
  abstract insertBatch(rows: ProductEventRow[]): Promise<number>;

  /**
   * 按 UTC 日历天与事件名聚合计数。
   *
   * 分桶在 SQL 里做（`AT TIME ZONE 'UTC'`），不依赖连接时区。
   */
  abstract aggregateByDay(window: FunnelWindow): Promise<FunnelAggregateRow[]>;

  /**
   * 把一次失败归成「可安全记录」的稳定标识。
   *
   * 指纹只允许：Prisma 稳定错误码（`P1001`…）、错误类名、或 `DomainFailure`
   * 的 `code`。**绝不含驱动原文**——那可能带上连接串、主机名、表名。
   * 放在端口上是因为「什么算稳定码」是实现（Prisma）的知识。
   */
  abstract describeFailure(failure: unknown): string;
}
