/**
 * 跨上下文读端口（ADR-0009 reader port）：本上下文的**公共读面**。
 *
 * ## 为什么单独一个端口
 *
 * `DailyRecords`（`domain/record/records.ts`）是写侧聚合端口，只在模块内使用；
 * 下游上下文（today-suggestion / reports / today-analysis / assistant）需要的是
 * 「按区间读一批轻量事实」，与聚合加载无关。两者混在一起会让下游被迫依赖
 * 写模型，也是 ADR-0009 当初把读面单列的原因。
 *
 * ## 形状约束
 *
 * - 返回**轻量事实**（`DailyRecordFact`），只有数据列，没有 Prisma 查询 DSL。
 * - 规范顺序 `occurredAt asc, createdAt asc`；需要别的顺序由消费方在内存里重排。
 * - 一次最多 `MAX_READER_FACTS` 条：上下文查询不能随用户数据无限增长。
 *   要精确总数 / 最新时间请用专门的计数方法。
 */
import type { DailyRecordKind } from '../../domain/record/record-kind.js';

/** 跨模块可见的记录事实（ADR-0009）。 */
export interface DailyRecordFact {
  id: string;
  kind: DailyRecordKind;
  occurredAt: Date;
  occurredTime: string | null;
  title: string | null;
  value: string | null;
  unit: string | null;
  note: string | null;
  payload: unknown;
  mealAnalysisStatus: string | null;
  mealAnalysisUpdatedAt: Date | null;
  mealAnalysisFailureReason: string | null;
  mealHeadline: string | null;
  mealCalorieMin: number | null;
  mealCalorieMax: number | null;
  mealCalorieBucket: string | null;
  createdAt: Date;
}

/**
 * reader port 一次查询的硬上限。防止无界上下文查询拖慢 AI 管线
 * （ADR-0009 reader ports；架构评审 #15）。
 */
export const MAX_READER_FACTS = 500;

/** 按 id 读单条记录的最小投影（事件复查解析触发记录标题等场景）。 */
export interface DailyRecordSummaryFact {
  id: string;
  kind: DailyRecordKind;
  occurredAt: Date;
  occurredTime: string | null;
  title: string | null;
  value: string | null;
  unit: string | null;
  note: string | null;
  payload: unknown;
  attachmentCount: number;
  createdAt: Date;
}

export abstract class DailyRecordReaderPort {
  /**
   * 列出 `occurredAt` 落在 [from, to] 的非删除记录，最多 `MAX_READER_FACTS` 条。
   *
   * 超出上限时**截断**而不是报错：调用方要精确总数用 `countFactsInRange`。
   */
  abstract listFactsInRange(
    userId: string,
    from: Date,
    to: Date,
    kinds?: DailyRecordKind[],
  ): Promise<DailyRecordFact[]>;

  /** `occurredAt` 落在 [from, to] 的非删除记录精确条数。 */
  abstract countFactsInRange(
    userId: string,
    from: Date,
    to: Date,
    kinds?: DailyRecordKind[],
  ): Promise<number>;

  /** [from, to] 内非删除记录的最新 `createdAt`；没有记录时返回 `null`。 */
  abstract findLatestCreatedAtInRange(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<Date | null>;

  /**
   * 按 id 读单条（含附件条数），记录不存在或属于别人时返回 `null`。
   *
   * 这是 reader port 里唯一按 id 的方法：消费方（事件复查）已经知道 id，
   * 需要的是那一行的标题/时间，不是列表。
   */
  abstract findById(
    userId: string,
    id: string,
  ): Promise<DailyRecordSummaryFact | null>;

  /**
   * 按 id 读单条（含附件明细）。
   *
   * 与 {@link findById} 并存是因为消费方要的东西不同：事件复查只要标题/时间，
   * 助手与详情页需要附件对象键。
   */
  abstract findByIdWithAttachments(
    userId: string,
    id: string,
  ): Promise<DailyRecordFact | null>;
}
