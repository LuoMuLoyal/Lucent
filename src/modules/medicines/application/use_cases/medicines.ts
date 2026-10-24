import { Inject, Injectable, Logger } from '@nestjs/common';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { I18nService } from 'nestjs-i18n';

import { shuffleArray, safeParseLlmJson } from '../../../../common/index.js';
import {
  MEDICINE_SAFETY_TIPS_SOURCE,
  type MedicineSafetyTipItem,
  type MedicineSafetyTipsSourcePort,
} from '../ports/safety-tips.js';
import { LlmRuntimeService } from '../../../../llm-runtime/index.js';

/**
 * Fields extracted from a medicine-box photo.
 *
 * All four are always present and `null` when the model could not read them:
 * a missing key would make the generated clients fail to deserialize, which
 * turns "the photo was blurry" into "the request is broken".
 */
export type MedicineRecognitionFields = {
  name: string | null;
  approvalNumber: string | null;
  specification: string | null;
  manufacturer: string | null;
};

/**
 * Medicine use cases with **side effects** — everything that cannot be a read
 * model.
 *
 * - `recognizeMedicine` calls the LLM (costs money, is non-deterministic);
 * - `getRandomSafetyTips` draws a random subset per call.
 *
 * The three query paths that used to live here (search / detail / sequences)
 * moved to `application/read_models/*`: they are pure projections over the
 * knowledge sources and belong with the rest of the read side, where they can
 * be tested without this class's LLM and i18n seams.
 */
@Injectable()
export class MedicinesService {
  private static readonly SAFETY_TIPS_LIMIT = 4;

  private readonly logger = new Logger(MedicinesService.name);

  constructor(
    @Inject(MEDICINE_SAFETY_TIPS_SOURCE)
    private readonly safetyTipsSource: MedicineSafetyTipsSourcePort,
    private readonly i18n: I18nService,
    private readonly llmRuntime: LlmRuntimeService,
  ) {}

  async recognizeMedicine(
    imageUrl: string,
  ): Promise<MedicineRecognitionFields> {
    const model = this.llmRuntime.createChatModel('chat', {
      temperature: 0.1,
    });

    const response = await model.invoke([
      new SystemMessage(this.i18n.t('medicine.recognize_prompt')),
      new HumanMessage({
        content: [
          {
            type: 'text',
            text: this.i18n.t('medicine.recognize_user_message'),
          },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      }),
    ]);

    const text =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

    const parsed = safeParseLlmJson(text, {
      logger: this.logger,
      context: 'medicine recognition',
    }) as MedicineRecognitionFields | null;

    return (
      parsed ?? {
        name: null,
        approvalNumber: null,
        specification: null,
        manufacturer: null,
      }
    );
  }

  // Dead-code endpoint (no C-end consumer); see docs/TODO.md.
  async getRandomSafetyTips(
    excludeIds: string[],
    lang?: string,
  ): Promise<MedicineSafetyTipItem[]> {
    const normalizedLang = (lang ?? 'en').toLowerCase();
    const useChinese = normalizedLang.startsWith('zh');

    const allActiveTips = await this.safetyTipsSource.listActiveCached();

    if (allActiveTips.length === 0) {
      return [];
    }

    const excludedIdSet = new Set(excludeIds);
    const availableTips = allActiveTips.filter(
      (tip) => !excludedIdSet.has(tip.id),
    );

    const selected = availableTips.length > 0 ? availableTips : allActiveTips;

    return shuffleArray(selected)
      .slice(0, MedicinesService.SAFETY_TIPS_LIMIT)
      .map((tip) => ({
        id: tip.id,
        text: useChinese ? tip.contentZh : tip.contentEn,
        category: tip.category,
      }));
  }
}
