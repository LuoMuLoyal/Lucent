import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import type { TodayRecommendationResponseDto } from '../../dto/recommendation-response.dto.js';

interface GuideSource {
  id: string;
  /** i18n key under `today-analysis.guides.*` holding the guide text. */
  textKey: string;
  category: string;
}

@Injectable()
export class TodayRecommendationsService {
  /**
   * Guide definitions carry an i18n key instead of inline zh/en pairs.
   *
   * The copy lives in `src/i18n/{zh-CN,en}/today-analysis.json` so it follows
   * the same path as every other user-visible string, and adding a language no
   * longer means editing this file (see docs/TODO.md「AI 侧固定中文」).
   */
  private readonly guides: GuideSource[] = [
    {
      id: 'add-medicine',
      textKey: 'guides.add_medicine',
      category: 'onboarding',
    },
    { id: 'log-water', textKey: 'guides.log_water', category: 'onboarding' },
    {
      id: 'record-sleep',
      textKey: 'guides.record_sleep',
      category: 'onboarding',
    },
    { id: 'check-mood', textKey: 'guides.check_mood', category: 'onboarding' },
  ];

  constructor(private readonly i18n: I18nService) {}

  /**
   * Returns deterministic cold-start guide cards.
   *
   * Previously this endpoint returned randomized daily "recommendations" that
   * pretended to be personalized suggestions. It now returns system-owned,
   * read-only onboarding guides that are only shown when the analysis engine
   * has no personalized output to display. The same id-based exclusion logic
   * is preserved for clients that still paginate/dedupe.
   */
  getColdStartGuides(
    excludeIds: string[],
    lang?: string,
  ): TodayRecommendationResponseDto[] {
    const normalizedLang = (lang ?? 'en').toLowerCase();
    const resolvedLang = normalizedLang.startsWith('zh') ? 'zh-CN' : 'en';

    const excludedIdSet = new Set(excludeIds);
    return this.guides
      .filter((item) => !excludedIdSet.has(item.id))
      .map((item) => ({
        id: item.id,
        text: this.i18n.t(`today-analysis.${item.textKey}`, {
          lang: resolvedLang,
        }),
        category: item.category,
      }));
  }
}
