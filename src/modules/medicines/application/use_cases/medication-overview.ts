import { Inject, Injectable } from '@nestjs/common';

import { unwrapResult } from '../../../../common/result/index.js';
import {
  getCanonicalIngredientKeys,
  getDrugbankIds,
} from '../../domain/services/ingredient-canonicalization.js';
import {
  buildMedicationOverview,
  type MedicationFact,
  type MedicationOverview,
} from '../../domain/services/medication-overview.js';
import type { MedicineDetailWrapper } from '../../domain/services/ingredient-canonicalization.js';
import {
  MEDICINE_RISK_RECORDS,
  type MedicineRiskRecordsPort,
} from '../ports/risk-records.js';
import { MedicinesService } from './medicines.js';

/** 一次全景分析最多纳入的药数。与风险检查的上限保持一致。 */
const OVERVIEW_MAX_MEDICINES = 100;

/**
 * 用药全景分析。
 *
 * ## 与 `risk-check` 的区别
 *
 * `risk-check` 回答「**这一组药有没有冲突**」，逐对判定并给出风险等级；
 * 这里回答「**我实际在吃的是什么组合**」——同一成分吃了几份、这些药在药理上
 * 交汇在哪、有没有哪个药同时挂在几条病程下。
 *
 * 两者的数据来源相同（当前在服药品），但结论的性质不同：前者是判级，
 * 后者是**描述**。所以它没有「风险等级」这种字段，只有分组与计数。
 *
 * ## 为什么图是可选的
 *
 * 重复成分与来源分组只依赖 Prisma 与成分解析，不依赖图。把图相关部分做成可选，
 * 意味着图不可用时这两个最有价值的发现仍然可用——而不是整个端点一起失败。
 */
@Injectable()
export class MedicationOverviewService {
  constructor(
    @Inject(MEDICINE_RISK_RECORDS)
    private readonly riskRecords: MedicineRiskRecordsPort,
    private readonly medicinesService: MedicinesService,
  ) {}

  /**
   * 生成某用户的用药全景。
   *
   * @param userId 用户 id。
   * @returns 全景；用户没有在服药品时给空聚合（而不是 null——「没在吃药」
   *   是一个有效答案，不是错误）。
   */
  async build(userId: string): Promise<MedicationOverview> {
    const context = await this.riskRecords.loadHealthContext(
      userId,
      OVERVIEW_MAX_MEDICINES,
    );
    const currentMedicines = context?.currentMedicines ?? [];
    if (currentMedicines.length === 0) {
      return buildMedicationOverview([]);
    }

    // 与 risk-check 相同：只有带 source + sourceRefId 的条目能查到详情。
    // 详情要包上 `item` 才能参与成分归一化（`getCanonicalIngredientKeys` 依赖它）。
    const details = await Promise.allSettled(
      currentMedicines.map(async (item) => {
        const sourceRefId = item.sourceRefId?.trim();
        if (
          (item.source !== 'cn' && item.source !== 'drugbank') ||
          sourceRefId == null ||
          sourceRefId === ''
        ) {
          return null;
        }
        const source = item.source;
        const detail = await unwrapResult(
          this.medicinesService.getDetailWithCache(
            sourceRefId,
            { source },
            false,
          ),
        );
        return {
          item: {
            id: item.id,
            source,
            sourceRefId,
            displayName: item.displayName,
            startedAt: item.startedAt,
          },
          detail,
        } satisfies MedicineDetailWrapper;
      }),
    );

    const facts: MedicationFact[] = currentMedicines.map((item, index) => {
      const settled = details[index];
      const wrapper = settled?.status === 'fulfilled' ? settled.value : null;
      return {
        entryId: item.id,
        displayName: item.displayName,
        drugbankId: wrapper === null ? null : firstDrugbankId(wrapper),
        ingredientKeys:
          wrapper === null ? [] : [...getCanonicalIngredientKeys(wrapper)],
        // 健康事件关联不在 `CurrentMedicineRow` 里（那个 port 属风险检查，
        // 改它会牵动既有行为）。全景暂时只区分「已归类」与「未归类」，
        // 具体事件分组见 `docs/TODO.md` 的用药全景跟进项。
        healthEventIds: [],
      };
    });

    return buildMedicationOverview(facts);
  }
}

function firstDrugbankId(detail: MedicineDetailWrapper): string | null {
  const ids = getDrugbankIds(detail);
  return ids.values().next().value ?? null;
}
