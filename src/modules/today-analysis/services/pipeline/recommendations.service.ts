import { Injectable } from '@nestjs/common';
import { shuffleArray } from '../../../../common';
import type { TodayRecommendationResponseDto } from '../../dto/recommendation-response.dto';

interface RecommendationSource {
  id: string;
  contentEn: string;
  contentZh: string;
  category?: string;
}

@Injectable()
export class TodayRecommendationsService {
  private static readonly LIMIT = 3;

  private readonly recommendations: RecommendationSource[] = [
    {
      id: 'hydration',
      contentEn: 'Drink a glass of water to stay hydrated.',
      contentZh: '喝杯水，保持身体水分充足。',
      category: 'habit',
    },
    {
      id: 'sleep',
      contentEn: 'Go to bed 15 minutes earlier tonight.',
      contentZh: '今晚早睡 15 分钟。',
      category: 'sleep',
    },
    {
      id: 'record-meal',
      contentEn: 'Log your main meal to track nutrition.',
      contentZh: '记录一餐，追踪饮食情况。',
      category: 'record',
    },
    {
      id: 'record-symptom',
      contentEn: 'Note any symptoms early so trends are easier to spot.',
      contentZh: '尽早记录症状，方便发现趋势。',
      category: 'record',
    },
    {
      id: 'medicine-safety',
      contentEn: 'Review your current medicines for interactions.',
      contentZh: '检查当前药品是否有相互作用。',
      category: 'medicine',
    },
    {
      id: 'walk',
      contentEn: 'Take a 10-minute walk if you have been sitting long.',
      contentZh: '久坐后起来走 10 分钟。',
      category: 'habit',
    },
    {
      id: 'mood',
      contentEn: 'Check in with how you feel today.',
      contentZh: '记录一下今天的心情。',
      category: 'record',
    },
    {
      id: 'report',
      contentEn: 'Look at this week’s health report for patterns.',
      contentZh: '查看本周健康报告，发现规律。',
      category: 'report',
    },
  ];

  getRandomRecommendations(
    excludeIds: string[],
    lang?: string,
  ): TodayRecommendationResponseDto[] {
    const normalizedLang = (lang ?? 'en').toLowerCase();
    const useChinese = normalizedLang.startsWith('zh');

    const excludedIdSet = new Set(excludeIds);
    const available = this.recommendations.filter(
      (item) => !excludedIdSet.has(item.id),
    );

    const selected = available.length > 0 ? available : this.recommendations;

    return shuffleArray(selected)
      .slice(0, TodayRecommendationsService.LIMIT)
      .map((item) => {
        const recommendation: TodayRecommendationResponseDto = {
          id: item.id,
          text: useChinese ? item.contentZh : item.contentEn,
        };
        if (item.category != null) {
          recommendation.category = item.category;
        }
        return recommendation;
      });
  }
}
