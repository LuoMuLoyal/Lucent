import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { SuggestionRule, RuleContext } from '../../../types/rule.types.js';

import type { SuggestionSignal } from '../../../types/signal.types.js';

import type { SuggestionCandidate } from '../../../types/candidate.types.js';
import {
  SuggestionType,
  TriggerType,
  SuggestionConfidence,
} from '../../../types/suggestion.types.js';
import {
  DIET_IMBALANCE_BASE_SCORE,
  DIET_IMBALANCE_MIN_DAYS,
} from '../../../constants/thresholds.constants.js';
import type { MealAnalysisItemKind } from '../../../../daily-records/index.js';

interface DailyDietFacets {
  date: string;
  analyzedMeals: number;
  facets: Partial<Record<MealAnalysisItemKind, 'low' | 'ok' | 'high'>>;
}

/**
 * 值得留意的档位方向：`high` 侧是「偏多」，`low` 侧是「偏少」。
 *
 * `balance` / `other` 不进这个表：它们不是可执行的饮食维度（说不出「平衡偏多」该改什么），
 * 也不是本规则的判断依据——结论文案里可以出现，规则不消费。
 */
const HIGH_WATCH_KINDS: ReadonlySet<MealAnalysisItemKind> = new Set([
  'fried',
  'sugar',
  'sodium',
  'fat',
  'portion',
  'carb',
]);
const LOW_WATCH_KINDS: ReadonlySet<MealAnalysisItemKind> = new Set([
  'vegetable',
  'fruit',
  'protein',
]);

/**
 * 并列时的优先级：先挑最能落地的行为（油炸/糖/钠/份量），再挑「吃得太少」的维度。
 * 只影响哪个维度占据文案主位，不影响是否触发。
 */
const WATCH_KIND_PRIORITY: readonly MealAnalysisItemKind[] = [
  'fried',
  'sugar',
  'sodium',
  'portion',
  'carb',
  'fat',
  'vegetable',
  'protein',
  'fruit',
];

/**
 * Rule: diet_imbalance
 * Type: BEHAVIOR_ADVICE
 * Trigger: TIMER
 *
 * 消费 `diet_facets` 信号（餐食分析 `facets` 封闭词表的按日投影），在观察窗口内
 * 至少 {@link DIET_IMBALANCE_MIN_DAYS} 天出现同一个值得留意的维度时给出饮食结构提示。
 *
 * 为什么不需要基线：`facets` 是模型对「这一餐」的直接判断（油炸偏多、蔬菜偏少），
 * 不是需要跟个人历史比较才成立的偏差；低置信 + 不做医疗断言已经足够克制。
 */
@Injectable()
export class DietImbalanceRuleService implements SuggestionRule {
  readonly ruleId = 'diet_imbalance';
  readonly ruleVersion = '1.0.0';
  readonly type = SuggestionType.BEHAVIOR_ADVICE;
  readonly triggerType = TriggerType.TIMER;
  readonly isBaselineRequired = false;
  readonly baselineDimensions = [];
  readonly consumableSignalKinds = ['diet_facets'];

  match(
    signals: SuggestionSignal[],
    _context: RuleContext,
  ): SuggestionCandidate | null {
    const dietSignal = signals.find(
      (s) => s.kind === 'diet_facets' && s.source === 'record',
    );
    if (dietSignal == null) {
      return null;
    }

    const dailyFacets = dietSignal.payload['dailyFacets'] as
      | DailyDietFacets[]
      | null;
    const analyzedMealCount =
      (dietSignal.payload['analyzedMealCount'] as number | undefined) ?? 0;
    const windowDays =
      (dietSignal.payload['windowDays'] as number | undefined) ?? 0;

    if (
      dailyFacets == null ||
      dailyFacets.length < DIET_IMBALANCE_MIN_DAYS ||
      analyzedMealCount === 0
    ) {
      return null;
    }

    // 每个维度出现在多少天：按「天」计数而非按餐，避免一天多餐把结论推偏。
    const watchDays = new Map<MealAnalysisItemKind, number>();
    for (const day of dailyFacets) {
      for (const kind of this.watchKindsIn(day)) {
        watchDays.set(kind, (watchDays.get(kind) ?? 0) + 1);
      }
    }

    const ranked = Array.from(watchDays.entries())
      .filter(([, days]) => days >= DIET_IMBALANCE_MIN_DAYS)
      .sort(
        ([leftKind, leftDays], [rightKind, rightDays]) =>
          rightDays - leftDays ||
          this.priorityOf(leftKind) - this.priorityOf(rightKind),
      );
    const top = ranked[0];
    if (top == null) {
      return null;
    }
    const [facetKind, facetDays] = top;

    return {
      candidateId: randomUUID(),
      ruleId: this.ruleId,
      ruleVersion: this.ruleVersion,
      type: this.type,
      triggerType: this.triggerType,
      evidence: [
        {
          kind: 'record',
          label: 'diet_watch_days',
          value: 'diet_watch_days_value',
          args: { days: facetDays, windowDays },
        },
        {
          kind: 'record',
          label: 'diet_analyzed_meals',
          value: String(analyzedMealCount),
        },
      ],
      primaryAction: {
        actionId: 'go_record_meal',
        label: 'record_meal',
        route: '/record/create?kind=meal',
        authRequired: true,
      },
      priorityScore: DIET_IMBALANCE_BASE_SCORE,
      confidence: SuggestionConfidence.LOW,
      notificationEligible: false,
      subtype: 'diet',
      copyGeneration: {
        templateKey: 'diet.imbalance',
        params: {
          facetKind,
          facetDays,
          analyzedMeals: analyzedMealCount,
          windowDays,
        },
      },
    };
  }

  private watchKindsIn(day: DailyDietFacets): MealAnalysisItemKind[] {
    const kinds: MealAnalysisItemKind[] = [];
    for (const [kind, level] of Object.entries(day.facets) as Array<
      [MealAnalysisItemKind, 'low' | 'ok' | 'high']
    >) {
      if (level === 'high' && HIGH_WATCH_KINDS.has(kind)) {
        kinds.push(kind);
      } else if (level === 'low' && LOW_WATCH_KINDS.has(kind)) {
        kinds.push(kind);
      }
    }
    return kinds;
  }

  private priorityOf(kind: MealAnalysisItemKind): number {
    const index = WATCH_KIND_PRIORITY.indexOf(kind);
    return index === -1 ? WATCH_KIND_PRIORITY.length : index;
  }
}
