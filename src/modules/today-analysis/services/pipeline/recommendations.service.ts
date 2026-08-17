import { Injectable } from '@nestjs/common';
import type { TodayRecommendationResponseDto } from '../../dto/recommendation-response.dto';

interface GuideSource {
  id: string;
  contentEn: string;
  contentZh: string;
  category: string;
}

@Injectable()
export class TodayRecommendationsService {
  private readonly guides: GuideSource[] = [
    {
      id: 'add-medicine',
      contentEn: 'Add your current medicines and set up reminder plans.',
      contentZh: '在用药页添加当前服用的药品，建立提醒计划。',
      category: 'onboarding',
    },
    {
      id: 'log-water',
      contentEn: 'Log a glass of water to start tracking daily intake.',
      contentZh: '记录一次饮水，帮助追踪每日摄入。',
      category: 'onboarding',
    },
    {
      id: 'record-sleep',
      contentEn:
        "Record last night's sleep so trend analysis becomes more accurate.",
      contentZh: '记录昨晚睡眠，趋势分析会更准确。',
      category: 'onboarding',
    },
    {
      id: 'check-mood',
      contentEn:
        'Check in with your mood to build a long-term emotional picture.',
      contentZh: '随手记录心情，长期观察情绪变化。',
      category: 'onboarding',
    },
  ];

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
    const useChinese = normalizedLang.startsWith('zh');

    const excludedIdSet = new Set(excludeIds);
    return this.guides
      .filter((item) => !excludedIdSet.has(item.id))
      .map((item) => ({
        id: item.id,
        text: useChinese ? item.contentZh : item.contentEn,
        category: item.category,
      }));
  }
}
