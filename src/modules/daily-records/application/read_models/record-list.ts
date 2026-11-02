/**
 * 日报记录的一条读模型条目（`GET /daily-records`、创建/更新响应、汇总里的 `latest`）。
 *
 * 这是**传输形状**：日期已经格式化成字符串，餐食 payload 在列表读里是 `null`
 * （分析结论走投影字段）。字段与 `adapters/http/dto/record-item.ts` 的 zod schema
 * 一一对应，序列化时由 zod 再收敛一次。
 *
 * 与投影函数分文件：`record-row.ts`（领域形状 → 读模型）在别处被引用，
 * 这里只放类型，避免投影文件 import 自己。
 */

export interface RecordAttachmentItem {
  id: string;
  kind: string;
  objectKey: string;
  bucket: string | null;
  provider: string | null;
  fileName: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  publicUrl: string | null;
  createdAt: string;
}

export interface RecordItem {
  id: string;
  kind: string;
  healthEventId: string | null;
  /** `YYYY-MM-DD`。 */
  occurredAt: string;
  occurredTime: string | null;
  title: string | null;
  value: string | null;
  unit: string | null;
  note: string | null;
  source: string | null;
  /**
   * kind 专属结构化数据。餐食记录只有在**详情**读里才返回完整
   * `payload.mealAnalysis`；列表读为 `null`。
   */
  payload: Record<string, unknown> | null;
  mealAnalysisStatus: string | null;
  mealAnalysisUpdatedAt: string | null;
  mealAnalysisFailureReason: string | null;
  mealHeadline: string | null;
  mealCalorieMin: number | null;
  mealCalorieMax: number | null;
  mealCalorieBucket: string | null;
  attachments: RecordAttachmentItem[];
  createdAt: string;
  updatedAt: string;
}

/** 一页列表。 */
export interface RecordList {
  items: RecordItem[];
  total: number;
}

/** 按 kind 汇总的一天。 */
export interface RecordSummary {
  summaries: RecordSummaryEntry[];
}

export interface RecordSummaryEntry {
  kind: string;
  count: number;
  latest: RecordItem | null;
}
