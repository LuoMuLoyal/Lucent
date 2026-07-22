/**
 * Prompts for AI-powered suggestion copy generation.
 */

export interface CopyGenerationOptions {
  locale: string;
  tone?: 'gentle' | 'direct' | 'professional';
}

/**
 * Builds the system prompt for copy generation.
 */
export function buildCopySystemPrompt(options: CopyGenerationOptions): string {
  const { locale, tone = 'gentle' } = options;

  const toneInstructions: Record<string, string> = {
    gentle:
      'Use a warm, supportive, and non-judgmental tone. Avoid alarmist language.',
    direct:
      'Be clear and concise, but still respectful. Get to the point quickly.',
    professional:
      'Use clinical precision with empathy. Suitable for health-related content.',
  };
  const toneKey = tone as string;

  return `You are a health assistant copywriter specializing in personalized wellness suggestions.

## Task
Generate suggestion card copy based on the provided template key and parameters. The copy should feel natural, helpful, and appropriately cautious about health claims.

## Language
Generate ALL output in: ${locale}

## Tone
${toneInstructions[toneKey] ?? toneInstructions.gentle ?? 'gentle'}

## Output Format
Respond with a JSON object containing:
- title: string (max 20 characters, action-oriented, no punctuation at end)
- reason: string (1-2 sentences explaining the situation, include specific numbers from params)
- boundary: string (1 sentence clarifying limitations, always include "仅供参考" or equivalent)
- actionLabel: string (max 6 characters, verb-first, imperative mood)

## Rules
1. Title should be concise and describe the situation
2. Reason should incorporate the provided parameters naturally
3. Boundary must acknowledge that this is algorithmic advice, not medical diagnosis
4. ActionLabel should be a clear call-to-action
5. Never make absolute medical claims (use "可能", "建议", "有助于" etc.)
6. For medication reminders, emphasize user agency ("请确认" not "您必须")
7. For trend alerts, use cautious language ("显示趋势" not "确诊")

## Templates Reference
- coverage.profile.incomplete: Profile missing fields
- coverage.record.empty_today: No records today
- missed.dose.pending: Overdue medication dose
- water.behind.target: Water intake below target
- sleep.shortfall: Sleep duration insufficient
- mood.sleep.correlation: Low mood + poor sleep correlation
- caffeine.sleep.correlation: Caffeine + declining sleep correlation
- symptom.deteriorating.trend: Worsening symptom trend`;
}

/**
 * Builds the user prompt for copy generation.
 */
export function buildCopyUserPrompt(
  templateKey: string,
  params: Record<string, string | number>,
): string {
  return `Generate suggestion copy for:

Template: ${templateKey}
Parameters: ${JSON.stringify(params, null, 2)}

Respond with valid JSON only.`;
}

/**
 * Builds a few-shot example prompt for better copy quality.
 */
export function buildCopyFewShotExamples(locale: string): string {
  if (locale.startsWith('zh')) {
    return `## Examples

Template: water.behind.target
Params: {"completedCount": 2, "targetCount": 8, "remainingCount": 6, "completionRate": 25}
Output:
{
  "title": "今日饮水还差 6 杯",
  "reason": "目前已记录 2 杯，距离目标还有 6 杯，完成度 25%。",
  "boundary": "饮水建议仅供参考，请根据个人情况调整。",
  "actionLabel": "去记录"
}

Template: missed.dose.pending
Params: {"medicineName": "维生素 D", "timeLabel": "08:00", "hoursOverdue": 2, "minsRemainder": 30}
Output:
{
  "title": "08:00 维生素 D 待确认",
  "reason": "计划服药时间已过 2 小时 30 分钟，请确认是否已服用。",
  "boundary": "此提醒基于您的用药计划，不能替代医生或药师建议。",
  "actionLabel": "去确认"
}`;
  }

  // English examples
  return `## Examples

Template: water.behind.target
Params: {"completedCount": 2, "targetCount": 8, "remainingCount": 6, "completionRate": 25}
Output:
{
  "title": "6 cups of water to go",
  "reason": "You've logged 2 cups so far, with 6 more to reach your daily goal of 8.",
  "boundary": "Hydration advice is for reference only. Adjust to your personal needs.",
  "actionLabel": "Log now"
}

Template: missed.dose.pending
Params: {"medicineName": "Vitamin D", "timeLabel": "08:00", "hoursOverdue": 2, "minsRemainder": 30}
Output:
{
  "title": "08:00 Vitamin D pending",
  "reason": "Your scheduled dose is 2 hours 30 minutes overdue. Please confirm if taken.",
  "boundary": "This reminder is based on your schedule and does not replace medical advice.",
  "actionLabel": "Confirm"
}`;
}
