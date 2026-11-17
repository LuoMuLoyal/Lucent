/**
 * 候选生成的**应用层发布语言**：形状定义在这里，由 adapter 反向引用。
 *
 * ## 为什么不下沉到 adapters/http/dto
 *
 * `ddd-application-no-infra-or-adapters` 禁止 `application/**` import 任何模块的
 * `adapters/**`。候选生成的编排（`application/use_cases/generate-candidates.ts`）
 * 与文案服务都需要「候选长什么样」，所以形状必须定义在应用层；HTTP 的 zod schema
 * 在 adapters 里 `satisfies` 这个形状（由 `adapters/http/dto/candidates/*` 引用）。
 *
 * 这里刻意**不**用 zod：应用层不依赖校验库，形状只是接口。
 */

/** 候选记录支持的 kind（与 `candidate-contract.ts` 的 zod 词表一致）。 */
export const DAILY_RECORD_CANDIDATE_KINDS = [
  'water',
  'meal',
  'symptom',
  'note',
  'sleep',
  'vital',
  'activity',
] as const;

export type DailyRecordCandidateKind =
  (typeof DAILY_RECORD_CANDIDATE_KINDS)[number];

/** 一条候选记录（尚未保存，等用户确认）。 */
export interface DailyRecordCandidateItem {
  kind: DailyRecordCandidateKind;
  occurredAt: string;
  title: string | null;
  value: string | null;
  unit: string | null;
  note: string | null;
  payload: Record<string, unknown> | null;
  rationale: string;
}

/** 候选生成的结果（`POST /daily-records/candidate-records/generate` 的响应体）。 */
export interface DailyRecordCandidateData {
  locale: string;
  generatedAt: string;
  confirmationHint: string;
  items: DailyRecordCandidateItem[];
}

/** 候选生成的入参（HTTP DTO 结构上兼容，控制器直接透传）。 */
export interface GenerateCandidatesInput {
  text: string;
  occurredAt: string;
  timezone?: string | undefined;
}
