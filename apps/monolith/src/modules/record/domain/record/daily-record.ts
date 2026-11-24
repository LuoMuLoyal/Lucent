/**
 * 日报记录聚合根。
 *
 * ## 聚合边界
 *
 * `DailyRecord` 拥有的是 `user_daily_records` 一行 + 它的附件行
 * （`user_daily_record_attachments`）：附件没有独立生命周期，删记录即删附件，
 * 所以它们在**同一个**聚合里。餐食分析结果不是独立聚合——它是记录的 payload
 * 与投影列，写它也是一次记录更新（见 `domain/meal/meal-analysis.ts`）。
 *
 * ## 不变量（这里只放不需要 IO 就能判定的那些）
 *
 * - 记录归属单用户；跨用户访问在应用层收敛成 `RESOURCE_NOT_FOUND`（不泄漏存在性）。
 * - 软删除后记录不再出现在任何读路径。
 * - 餐食记录的 payload 里只有 `dishes` 可由客户端改（见 `domain/meal/meal-analysis.ts`）。
 * - 睡眠记录必须是「完整一段」：起止成对、结束晚于开始、时长 > 0。
 *
 * ## 领域纯度
 *
 * 只 import 同 `domain/` 树内的文件。没有框架、没有 IO、没有 `common/result`：
 * 行为返回领域词汇（`null` / `RecordPayloadProblem`），由应用层映射成
 * `DomainFailure`。
 */
import { isMeal, type DailyRecordKind } from './record-kind.js';

/** 记录的一次加载快照（写侧需要的字段）。 */
export interface DailyRecordState {
  id: string;
  userId: string;
  kind: DailyRecordKind;
  occurredAt: Date;
  payload: unknown;
  deletedAt: Date | null;
}

/** 归属判定的三种结果。 */
export type OwnershipVerdict = 'owned' | 'other-user' | 'missing';

/** payload 校验的失败原因（应用层翻成 `VALIDATION_FAILED`）。 */
export type RecordPayloadProblem =
  | 'payload-required'
  | 'sleep-pair-incomplete'
  | 'sleep-interval-invalid'
  | 'sleep-duration-invalid'
  | 'sleep-type-invalid'
  | 'sleep-quality-invalid'
  | 'symptom-code-invalid'
  | 'symptom-severity-invalid'
  | 'symptom-custom-label-invalid'
  | 'vital-shape-invalid'
  | 'activity-shape-invalid';

/** 症状严重度码词汇（与客户端 `SymptomSeverity` 及 health-context 过敏严重度一致）。 */
export const SYMPTOM_SEVERITIES = [
  'mild',
  'moderate',
  'severe',
  'unknown',
] as const;

const SYMPTOM_SEVERITY_SET: ReadonlySet<string> = new Set(SYMPTOM_SEVERITIES);

const SLEEP_TYPES = ['nightSleep', 'nap'] as const;

type PlainRecord = Record<string, unknown>;

function asPlainRecord(raw: unknown): PlainRecord | null {
  return raw != null && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as PlainRecord)
    : null;
}

export class DailyRecord {
  private constructor(private readonly state: DailyRecordState) {}

  static from(state: DailyRecordState): DailyRecord {
    return new DailyRecord(state);
  }

  get id(): string {
    return this.state.id;
  }

  get userId(): string {
    return this.state.userId;
  }

  get kind(): DailyRecordKind {
    return this.state.kind;
  }

  get occurredAt(): Date {
    return this.state.occurredAt;
  }

  get payload(): unknown {
    return this.state.payload;
  }

  get isDeleted(): boolean {
    return this.state.deletedAt != null;
  }

  get isMeal(): boolean {
    return isMeal(this.state.kind);
  }

  /**
   * 归属判定。
   *
   * 存在的记录被别人持有时返回 `other-user` 而不是 `missing`——这是**唯一**需要
   * 区分两者的地方（应用层决定对外都回 404，但日志与审计要知道是哪种）；
   * 调用方不得把三种结果直接透给客户端。
   */
  ownershipFor(userId: string): OwnershipVerdict {
    if (this.isDeleted) {
      return 'missing';
    }
    return this.state.userId === userId ? 'owned' : 'other-user';
  }

  /**
   * 校验该 kind 的 payload 形状（创建时）。
   *
   * 只是「能不能存」的判定，不做任何语义归一——归一在
   * `domain/meal/meal-analysis.ts` 与写侧完成。
   */
  static validatePayload(
    kind: DailyRecordKind,
    payload: Record<string, unknown> | undefined,
  ): RecordPayloadProblem | null {
    switch (kind) {
      case 'sleep':
        return validateSleepPayload(payload);
      case 'symptom':
        return validateSymptomPayload(payload);
      case 'vital':
        return validateVitalPayload(payload);
      case 'activity':
        return validateActivityPayload(payload);
      default:
        return null;
    }
  }

  /**
   * 更新后的终态校验：kind 可能被改，payload 可能没提交（沿用旧值）。
   *
   * 只在**终态是睡眠**时校验——把一条睡眠记录改成别的 kind 时，旧的睡眠 payload
   * 不再需要满足睡眠约束。
   */
  static validateFinalState(input: {
    kind: DailyRecordKind;
    payload: unknown;
  }): RecordPayloadProblem | null {
    if (input.kind !== 'sleep') {
      return null;
    }
    return validateSleepPayload(asPlainRecord(input.payload));
  }
}

/**
 * 睡眠 payload：起止成对、结束晚于开始、时长为正。
 *
 * 客户端可以只给 `durationMinutes`（手填），也可以给一段起止时间；但**半段**
 * 起止比没有更糟——汇总与趋势会把它当成 0 分钟睡眠，所以直接判非法。
 */
function validateSleepPayload(
  payload: PlainRecord | null | undefined,
): RecordPayloadProblem | null {
  if (payload == null) {
    return 'payload-required';
  }

  const sleepType = payload['sleepType'];
  if (
    sleepType !== undefined &&
    !SLEEP_TYPES.includes(sleepType as (typeof SLEEP_TYPES)[number])
  ) {
    return 'sleep-type-invalid';
  }

  const quality = payload['quality'];
  if (quality !== undefined && typeof quality !== 'string') {
    return 'sleep-quality-invalid';
  }

  const startedAt = payload['startedAt'];
  const endedAt = payload['endedAt'];
  if ((startedAt == null) !== (endedAt == null)) {
    return 'sleep-pair-incomplete';
  }
  if (startedAt != null && endedAt != null) {
    if (typeof startedAt !== 'string' || typeof endedAt !== 'string') {
      return 'sleep-interval-invalid';
    }
    const started = new Date(startedAt);
    const ended = new Date(endedAt);
    if (
      Number.isNaN(started.getTime()) ||
      Number.isNaN(ended.getTime()) ||
      ended.getTime() <= started.getTime()
    ) {
      return 'sleep-interval-invalid';
    }
  }

  const durationMinutes = payload['durationMinutes'];
  if (
    typeof durationMinutes !== 'number' ||
    !Number.isFinite(durationMinutes) ||
    durationMinutes <= 0
  ) {
    return 'sleep-duration-invalid';
  }

  return null;
}

/**
 * 症状 payload 是可选的（NLP 候选等可能只给 title），给定时校验形状。
 *
 * `symptom` 是目录码、`severity` 是严重度码；目录成员资格由症状目录端点定义，
 * 这里只保证类型与取值词汇，不重复目录清单。
 */
function validateSymptomPayload(
  payload: PlainRecord | null | undefined,
): RecordPayloadProblem | null {
  if (payload == null) return null;

  const symptom = payload['symptom'];
  if (
    symptom !== undefined &&
    (typeof symptom !== 'string' || symptom.trim().length === 0)
  ) {
    return 'symptom-code-invalid';
  }

  const severity = payload['severity'];
  if (
    severity !== undefined &&
    (typeof severity !== 'string' || !SYMPTOM_SEVERITY_SET.has(severity))
  ) {
    return 'symptom-severity-invalid';
  }

  const customLabel = payload['customLabel'];
  if (customLabel !== undefined && typeof customLabel !== 'string') {
    return 'symptom-custom-label-invalid';
  }

  return null;
}

function validateVitalPayload(
  payload: PlainRecord | null | undefined,
): RecordPayloadProblem | null {
  if (payload == null) return null;
  if (typeof payload['vitalType'] !== 'string') {
    return 'vital-shape-invalid';
  }
  if (typeof payload['value'] !== 'number') {
    return 'vital-shape-invalid';
  }
  return null;
}

function validateActivityPayload(
  payload: PlainRecord | null | undefined,
): RecordPayloadProblem | null {
  if (payload == null) return null;
  if (typeof payload['activityType'] !== 'string') {
    return 'activity-shape-invalid';
  }
  if (typeof payload['value'] !== 'number') {
    return 'activity-shape-invalid';
  }
  return null;
}
