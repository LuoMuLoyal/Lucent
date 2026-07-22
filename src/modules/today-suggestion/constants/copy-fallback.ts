/**
 * Fallback copy for when AI generation fails or is unavailable.
 *
 * These are pre-written, human-reviewed copies in multiple languages.
 * They serve as a safety net to ensure users always see meaningful content.
 */

export interface FallbackCopy {
  title: string;
  reason: string;
  boundary: string;
  actionLabel: string;
}

/**
 * Fallback copy organized by template key and locale.
 */
export const COPY_FALLBACK: Record<string, Record<string, FallbackCopy>> = {
  // Coverage templates
  'coverage.profile.incomplete': {
    'zh-CN': {
      title: '健康档案信息不完整',
      reason: '完善档案后可获得更准确的建议。',
      boundary: '完善档案有助于提供更准确的个性化建议。',
      actionLabel: '完善档案',
    },
    'en-US': {
      title: 'Health profile incomplete',
      reason: 'Complete your profile for more accurate suggestions.',
      boundary: 'A complete profile helps us provide personalized guidance.',
      actionLabel: 'Complete',
    },
  },
  'coverage.record.empty_today': {
    'zh-CN': {
      title: '今日还没有记录',
      reason: '记录饮水、症状或睡眠后，系统可以生成更有针对性的建议。',
      boundary: '数据不足时，系统只能提供通用建议。',
      actionLabel: '去记录',
    },
    'en-US': {
      title: 'No records today',
      reason: 'Log water, symptoms, or sleep to get personalized suggestions.',
      boundary: 'Without data, we can only provide general advice.',
      actionLabel: 'Record',
    },
  },

  // Compliance templates
  'missed.dose.pending': {
    'zh-CN': {
      title: '服药提醒待确认',
      reason: '有药品已超过计划时间，请确认是否已服用。',
      boundary: '此提醒基于您的用药计划，不能替代医生或药师建议。',
      actionLabel: '去确认',
    },
    'en-US': {
      title: 'Medication reminder pending',
      reason:
        'A medication is past its scheduled time. Please confirm if taken.',
      boundary: 'This reminder is based on your schedule, not medical advice.',
      actionLabel: 'Confirm',
    },
  },

  // Behavior advice templates
  'water.behind.target': {
    'zh-CN': {
      title: '今日饮水不足',
      reason: '当前饮水进度落后于目标，适当补水有助于保持健康。',
      boundary: '饮水建议仅供参考，请根据个人情况调整。',
      actionLabel: '去记录',
    },
    'en-US': {
      title: 'Water intake behind target',
      reason:
        'Your hydration is below target. Staying hydrated supports your health.',
      boundary: 'Hydration advice is for reference only. Adjust to your needs.',
      actionLabel: 'Record',
    },
  },
  'sleep.shortfall': {
    'zh-CN': {
      title: '昨晚睡眠不足',
      reason: '睡眠时长低于建议值，可能影响今日状态。',
      boundary: '睡眠建议仅供参考，持续睡眠问题请咨询医生。',
      actionLabel: '记录睡眠',
    },
    'en-US': {
      title: 'Insufficient sleep last night',
      reason: 'Sleep duration was below the recommended amount.',
      boundary:
        'Sleep advice is for reference. Consult a doctor for ongoing issues.',
      actionLabel: 'Log sleep',
    },
  },
  'mood.sleep.correlation': {
    'zh-CN': {
      title: '情绪与睡眠可能相关',
      reason: '近期情绪记录与睡眠数据显示一定关联，值得关注。',
      boundary: '情绪与睡眠的关系因人而异，持续情绪低落请寻求专业帮助。',
      actionLabel: '记录情绪',
    },
    'en-US': {
      title: 'Mood and sleep may be related',
      reason: 'Recent mood and sleep data show a possible connection.',
      boundary:
        'Mood-sleep relationships vary. Seek help for persistent low mood.',
      actionLabel: 'Log mood',
    },
  },
  'caffeine.sleep.correlation': {
    'zh-CN': {
      title: '咖啡因可能影响睡眠',
      reason: '近期咖啡因摄入与睡眠时长下降存在关联。',
      boundary: '咖啡因与睡眠的关系因人而异，如有持续睡眠问题请咨询医生。',
      actionLabel: '记录饮食',
    },
    'en-US': {
      title: 'Caffeine may affect sleep',
      reason:
        'Recent caffeine intake correlates with decreased sleep duration.',
      boundary:
        'Caffeine-sleep relationships vary. Consult a doctor for ongoing issues.',
      actionLabel: 'Log meal',
    },
  },

  // Trend templates
  'symptom.deteriorating.trend': {
    'zh-CN': {
      title: '症状趋势需关注',
      reason: '某项症状记录显示恶化趋势，建议留意身体变化。',
      boundary: '请尽快线下就医或咨询医生。',
      actionLabel: '记录症状',
    },
    'en-US': {
      title: 'Symptom trend requires attention',
      reason: 'A symptom shows a worsening trend. Monitor your condition.',
      boundary: 'Please consult a healthcare provider promptly.',
      actionLabel: 'Log symptom',
    },
  },
};

/**
 * Default locale to use when requested locale is not available.
 */
export const DEFAULT_FALLBACK_LOCALE = 'zh-CN';

/**
 * Gets fallback copy for a template key and locale.
 * Falls back to default locale if specific locale is not available.
 */
export function getFallbackCopy(
  templateKey: string,
  locale: string,
): FallbackCopy | null {
  const byLocale = COPY_FALLBACK[templateKey];
  if (!byLocale) {
    return null;
  }

  // Try requested locale first
  const exactMatch = byLocale[locale];
  if (exactMatch) {
    return exactMatch;
  }

  // Try language code only (e.g., 'zh' from 'zh-CN')
  const langCode = locale.split('-')[0];
  if (langCode) {
    for (const [key, value] of Object.entries(byLocale)) {
      if (key.startsWith(langCode)) {
        return value;
      }
    }
  }

  // Fall back to default locale
  return byLocale[DEFAULT_FALLBACK_LOCALE] ?? null;
}
