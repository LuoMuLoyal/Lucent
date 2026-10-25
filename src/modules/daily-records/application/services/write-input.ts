/**
 * 写用例的输入形状（应用层词汇）。
 *
 * ## 为什么不在应用层直接 import HTTP DTO
 *
 * `ddd-application-no-infra-or-adapters` 禁止 `application/**` import 任何模块的
 * `adapters/**`——DTO 活在 `adapters/http/dto/`，所以应用层不能引用它。
 *
 * 这里用**结构类型**描述「写一条记录需要哪些入参」：字段是 DTO 的子集，控制器把
 * 校验过的 DTO 直接传进来（结构兼容，无需 map）。好处是应用层不依赖 zod、不依赖
 * 传输形状；代价是 DTO 增字段时不会自动出现在这里——但那本来就应该是有意识的决定。
 */

/** 附件输入（创建与更新共用）。 */
export interface AttachmentInput {
  kind?: string | undefined;
  objectKey: string;
  bucket?: string | null | undefined;
  provider?: string | null | undefined;
  fileName?: string | null | undefined;
  contentType?: string | null | undefined;
  sizeBytes?: number | null | undefined;
  width?: number | null | undefined;
  height?: number | null | undefined;
  publicUrl?: string | null | undefined;
}

/** `POST /daily-records` 的入参。 */
export interface CreateRecordInput {
  kind: string;
  /** `YYYY-MM-DD`（DTO 已校验）。 */
  occurredAt: string;
  occurredTime?: string | null | undefined;
  title?: string | null | undefined;
  value?: string | null | undefined;
  unit?: string | null | undefined;
  note?: string | null | undefined;
  source?: string | null | undefined;
  healthEventId?: string | null | undefined;
  payload?: Record<string, unknown> | undefined;
  attachments?: ReadonlyArray<AttachmentInput> | undefined;
}

/**
 * `PATCH /daily-records/:id` 的入参。
 *
 * 每个字段的 `undefined` 都表示「不改」：这是 PATCH 的语义差异来源，
 * 不能用 `null` 代替（`null` 是显式清空）。
 */
export interface UpdateRecordInput {
  kind?: string | undefined;
  occurredAt?: string | undefined;
  occurredTime?: string | null | undefined;
  title?: string | null | undefined;
  value?: string | null | undefined;
  unit?: string | null | undefined;
  note?: string | null | undefined;
  healthEventId?: string | null | undefined;
  payload?: Record<string, unknown> | undefined;
  /** `undefined` = 附件不动；给数组 = 整体替换（空数组即清空）。 */
  attachments?: ReadonlyArray<AttachmentInput> | undefined;
}
