import { Inject, Injectable } from '@nestjs/common';
import { DailyRecordKind } from '#generated/prisma/client.js';
import {
  DailyRecordReaderPort,
  parseMealRecordPayload,
} from '../../../daily-records/index.js';
import { formatDateOnly, parseDateOnly } from '../../../../common/index.js';
import type { IDailyRecordReader } from '../../types/ports.js';
import { DAILY_RECORD_READER } from '../../types/ports.js';
import type { AssistantToolExecutionContext } from '../../types/assistant.types.js';
import {
  offsetDateString,
  resolveSingleDate,
  todayDateString,
} from '../shared/date-resolver.js';
import type {
  ToolMealAnalysisDigest,
  ToolMealAnalysisDigestEntry,
  ToolMutationHints,
  ToolMutationRankedRecord,
  ToolMutationTargetMatch,
  ToolRecordItem,
  ToolSingleDateResolution,
} from '../shared/tool-constants.js';
import {
  DEFAULT_MEAL_DIGEST_DAYS,
  DEFAULT_MEAL_DIGEST_LIMIT,
  MAX_MEAL_DIGEST_DAYS,
  MAX_MEAL_DIGEST_LIMIT,
  MUTATION_MATCH_WEIGHTS,
} from '../shared/tool-constants.js';

/**
 * Reads one positive-integer tool argument, clamped to `[1, max]`.
 *
 * The declared JSON schema already constrains the model, but a schema is not a
 * guarantee (older endpoints, malformed function calls), so the server clamps
 * again and reports whether it had to.
 */
function clampPositiveInt(
  raw: unknown,
  fallback: number,
  max: number,
): { value: number; requested: number | null; capped: boolean } {
  const parsed =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw)
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { value: fallback, requested: null, capped: false };
  }
  const requested = Math.floor(parsed);
  if (requested > max) {
    return { value: max, requested, capped: true };
  }
  return { value: requested, requested, capped: false };
}

@Injectable()
export class AssistantToolRecordQueryService {
  constructor(
    @Inject(DAILY_RECORD_READER)
    private readonly dailyRecordsService: IDailyRecordReader,
    private readonly dailyRecordReaderPort: DailyRecordReaderPort,
  ) {}

  async listToolRecords(
    userId: string,
    date: string,
    options: { includeSleep: boolean; sleepOnly?: boolean },
  ): Promise<ToolRecordItem[]> {
    const result = await this.dailyRecordsService.list(
      userId,
      date,
      undefined,
      1,
      100,
    );
    return result.items
      .filter((item) => {
        if (options.sleepOnly) {
          return item.kind === DailyRecordKind.sleep;
        }
        if (!options.includeSleep && item.kind === DailyRecordKind.sleep) {
          return false;
        }
        return true;
      })
      .map((item) => ({
        id: item.id,
        kind: item.kind,
        occurredAt: item.occurredAt,
        title: item.title ?? null,
        value: item.value ?? null,
        unit: item.unit ?? null,
        note: item.note ?? null,
        tags: this.buildTags(item),
        payload: item.payload ?? null,
        mealAnalysisStatus: item.mealAnalysisStatus ?? null,
        mealAnalysisUpdatedAt: item.mealAnalysisUpdatedAt ?? null,
        mealAnalysisFailureReason: item.mealAnalysisFailureReason ?? null,
        mealHeadline: item.mealHeadline ?? null,
        mealCalorieMin: item.mealCalorieMin ?? null,
        mealCalorieMax: item.mealCalorieMax ?? null,
        mealCalorieBucket: item.mealCalorieBucket ?? null,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      }));
  }

  /**
   * Builds the meal-analysis digest: already-computed analyses for the window
   * the model asked for, newest meal first.
   *
   * 为什么读投影列而不是逐条解析 payload：`analyzed` 判定、一行结论（`mealHeadline`）
   * 与热量区间都在 `UserDailyRecord` 的投影列上，跨 15 天的窗口只需一条范围查询；
   * 没有分析结果的餐食（`analyzing` / `analysis_failed`）直接被列过滤掉，其 payload
   * 从不解析。只有进入结果的 ≤`limit` 条餐食才回读 payload 取 `items` / `dishes` 明细。
   *
   * 这也是「不再重复识图」的落点：助手拿到的是一等公民的结构化区间与排序结论，
   * 而不是让它自己看图或从文案里猜。
   */
  async buildMealAnalysisDigest(
    userId: string,
    args: Record<string, unknown> | undefined,
  ): Promise<ToolMealAnalysisDigest> {
    const days = clampPositiveInt(
      args?.['days'],
      DEFAULT_MEAL_DIGEST_DAYS,
      MAX_MEAL_DIGEST_DAYS,
    );
    const limit = clampPositiveInt(
      args?.['limit'],
      DEFAULT_MEAL_DIGEST_LIMIT,
      MAX_MEAL_DIGEST_LIMIT,
    );

    const endDate = todayDateString();
    const startDate = offsetDateString(-(days.value - 1));
    const facts = await this.dailyRecordReaderPort.listFactsInRange(
      userId,
      parseDateOnly(startDate),
      parseDateOnly(endDate),
      [DailyRecordKind.meal],
    );

    const analyzed = facts
      .filter((fact) => fact.mealAnalysisStatus === 'analyzed')
      .sort(
        (left, right) =>
          right.occurredAt.getTime() - left.occurredAt.getTime() ||
          (right.occurredTime ?? '').localeCompare(left.occurredTime ?? '') ||
          right.createdAt.getTime() - left.createdAt.getTime(),
      );

    return {
      startDate,
      endDate,
      windowDays: days.value,
      limit: limit.value,
      requestedDays: days.requested,
      requestedLimit: limit.requested,
      daysCapped: days.capped,
      limitCapped: analyzed.length > limit.value,
      analyzedMealCount: analyzed.length,
      meals: analyzed
        .slice(0, limit.value)
        .map((fact) => this.toMealDigestEntry(fact)),
    };
  }

  private toMealDigestEntry(fact: {
    occurredAt: Date;
    occurredTime: string | null;
    title: string | null;
    payload: unknown;
    mealHeadline: string | null;
    mealCalorieMin: number | null;
    mealCalorieMax: number | null;
    mealCalorieBucket: string | null;
  }): ToolMealAnalysisDigestEntry {
    const analysis = parseMealRecordPayload(fact.payload).mealAnalysis ?? null;

    return {
      date: formatDateOnly(fact.occurredAt),
      occurredTime: fact.occurredTime,
      title: fact.title,
      headline: fact.mealHeadline,
      calorieRange:
        fact.mealCalorieMin != null && fact.mealCalorieMax != null
          ? {
              min: fact.mealCalorieMin,
              max: fact.mealCalorieMax,
              unit: 'kcal',
              bucket: fact.mealCalorieBucket,
            }
          : null,
      items: (analysis?.items ?? []).map((item) => ({
        rank: item.rank,
        kind: item.kind,
        polarity: item.polarity,
        headline: item.headline,
        detail: item.detail,
      })),
      dishes: (analysis?.dishes ?? []).map((dish) => dish.name),
    };
  }

  async findTargetDailyRecordForMutation(
    context: AssistantToolExecutionContext,
    input: {
      dateResolution: ToolSingleDateResolution;
      includeSleep?: boolean;
    },
  ): Promise<ToolMutationTargetMatch> {
    const records = await this.listToolRecords(
      context.userId,
      input.dateResolution.date,
      {
        includeSleep: input.includeSleep ?? true,
      },
    );
    const hints: ToolMutationHints = {
      kindHint: this.extractDailyRecordKindHint(context.userMessage),
      numericHint: this.extractNumericHint(context.userMessage),
      titleHint: this.extractQuotedOrTailHint(context.userMessage),
      noteHint: this.extractNoteHint(context.userMessage),
    };
    const ambiguities = [...input.dateResolution.ambiguities];
    const candidateCount = records.length;

    if (candidateCount === 0) {
      return {
        date: input.dateResolution.date,
        record: null,
        matchedBy: input.dateResolution.matchedBy,
        ambiguities,
        reason: 'No records exist on the selected date.',
        confidence: {
          level: 'low',
          reason:
            'Record mutation requires an existing record, but none were found on that date.',
        },
        candidateCount,
      };
    }

    if (
      hints.kindHint == null &&
      hints.numericHint == null &&
      hints.titleHint == null &&
      hints.noteHint == null
    ) {
      ambiguities.push(
        'Missing a stable record identifier. Use a kind plus value, a quoted title, or a note fragment.',
      );
      return {
        date: input.dateResolution.date,
        record: null,
        matchedBy: input.dateResolution.matchedBy,
        ambiguities,
        reason:
          'The request did not include enough detail to identify one record safely.',
        confidence: {
          level: 'low',
          reason:
            'Update/delete proposals are withheld unless the target record can be identified with high confidence.',
        },
        candidateCount,
      };
    }

    const ranked = records
      .map((record, index) => this.rankMutationTarget(record, hints, index))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score);

    const top = ranked[0];
    const second = ranked[1];
    if (top == null) {
      ambiguities.push(
        'The message hints did not match any existing record on the selected date.',
      );
      return {
        date: input.dateResolution.date,
        record: null,
        matchedBy: input.dateResolution.matchedBy,
        ambiguities,
        reason: 'No record matched the described kind/value/title/note hints.',
        confidence: {
          level: 'low',
          reason: 'No candidate record satisfied the requested mutation hints.',
        },
        candidateCount,
      };
    }

    const strongSignals = top.matchedBy.filter(
      (item) => item === 'value' || item === 'title' || item === 'note',
    );
    const hasStrongSignals = strongSignals.length > 0;
    const isSingleCandidateWithKind =
      candidateCount === 1 &&
      hints.kindHint != null &&
      top.matchedBy.includes('kind');
    const scoreGap =
      second == null ? Number.POSITIVE_INFINITY : top.score - second.score;

    if (!hasStrongSignals && !isSingleCandidateWithKind) {
      ambiguities.push(
        'Kind alone is not specific enough to mutate a record safely.',
      );
      return {
        date: input.dateResolution.date,
        record: null,
        matchedBy: [...input.dateResolution.matchedBy, ...top.matchedBy],
        ambiguities,
        reason: 'The best match is still too broad to modify safely.',
        confidence: {
          level: 'low',
          reason:
            'High-constraint mutation proposals require a stronger identifier than kind alone.',
        },
        candidateCount,
      };
    }

    if (scoreGap < 4) {
      ambiguities.push(
        'More than one record matched too closely, so no mutation proposal was created.',
      );
      return {
        date: input.dateResolution.date,
        record: null,
        matchedBy: [...input.dateResolution.matchedBy, ...top.matchedBy],
        ambiguities,
        reason:
          'Multiple nearby records remain too similar to distinguish safely.',
        confidence: {
          level: 'low',
          reason:
            'The highest-ranked candidate was not separated enough from the next candidate.',
        },
        candidateCount,
      };
    }

    return {
      date: input.dateResolution.date,
      record: top.record,
      matchedBy: [...input.dateResolution.matchedBy, ...top.matchedBy],
      ambiguities,
      reason: hasStrongSignals
        ? 'Matched one existing record with specific value/title/note evidence.'
        : 'Matched the only record on that date for the requested kind.',
      confidence: {
        level: hasStrongSignals ? 'high' : 'medium',
        reason: hasStrongSignals
          ? 'The target record was separated by specific user-provided hints.'
          : 'Only one record existed for the requested kind on the selected date.',
      },
      candidateCount,
    };
  }

  resolveSingleDate(
    userMessage: string,
    input: {
      fallbackDate: string;
      defaultAmbiguity: string;
    },
  ): ToolSingleDateResolution {
    return resolveSingleDate(userMessage, input);
  }

  private rankMutationTarget(
    record: ToolRecordItem,
    hints: ToolMutationHints,
    index: number,
  ): ToolMutationRankedRecord {
    const matchedBy: string[] = [];
    let score = 0;

    if (hints.kindHint != null) {
      if (record.kind !== hints.kindHint) {
        return { record, score: 0, matchedBy };
      }
      matchedBy.push('kind');
      score += MUTATION_MATCH_WEIGHTS.kind;
    }

    if (hints.numericHint != null && record.value === hints.numericHint) {
      matchedBy.push('value');
      score += MUTATION_MATCH_WEIGHTS.value;
    }

    if (
      hints.titleHint != null &&
      record.title != null &&
      record.title.toLowerCase().includes(hints.titleHint.toLowerCase())
    ) {
      matchedBy.push('title');
      score += MUTATION_MATCH_WEIGHTS.title;
    }

    if (
      hints.noteHint != null &&
      record.note != null &&
      record.note.toLowerCase().includes(hints.noteHint.toLowerCase())
    ) {
      matchedBy.push('note');
      score += MUTATION_MATCH_WEIGHTS.note;
    }

    if (matchedBy.length === 0 && hints.kindHint == null) {
      return { record, score: 0, matchedBy };
    }

    score += Math.max(0, MUTATION_MATCH_WEIGHTS.positionBonus - index);
    return { record, score, matchedBy };
  }

  private extractDailyRecordKindHint(userMessage: string): string | null {
    if (/喝水|饮水|water/i.test(userMessage)) {
      return DailyRecordKind.water;
    }
    if (/吃饭|饮食|meal/i.test(userMessage)) {
      return DailyRecordKind.meal;
    }
    if (/症状|头痛|不舒服|symptom/i.test(userMessage)) {
      return DailyRecordKind.symptom;
    }
    if (/备注|自定义|note/i.test(userMessage)) {
      return DailyRecordKind.note;
    }
    if (/睡眠|睡觉|sleep/i.test(userMessage)) {
      return DailyRecordKind.sleep;
    }
    return null;
  }

  private extractNumericHint(userMessage: string): string | null {
    const match = userMessage.match(
      /\b(\d+(?:\.\d+)?)\s*(ml|毫升|cup|cups|杯|次)?/i,
    );
    return match?.[1] != null ? match[1].trim() : null;
  }

  private extractQuotedOrTailHint(userMessage: string): string | null {
    const quoted = userMessage.match(/["“](.+?)["”]/);
    if (quoted?.[1] != null) {
      return quoted[1].trim();
    }
    const tail = userMessage.match(
      /(?:标题|title|那条|这条)\s*[:：]?\s*(.+)$/i,
    );
    return tail?.[1] != null ? tail[1].trim() : null;
  }

  private extractNoteHint(userMessage: string): string | null {
    const noteMatch = userMessage.match(
      /(?:备注|note|内容|content)\s*[:：]?\s*(.+)$/i,
    );
    return noteMatch?.[1] != null ? noteMatch[1].trim() : null;
  }

  private buildTags(item: {
    kind: DailyRecordKind;
    mealAnalysisStatus?: string | null;
  }): string[] {
    if (item.kind !== DailyRecordKind.meal) {
      return [];
    }

    const tags: string[] = [];
    if (item.mealAnalysisStatus != null) {
      tags.push(`meal_estimate:${item.mealAnalysisStatus}`);
    }
    return tags;
  }
}
