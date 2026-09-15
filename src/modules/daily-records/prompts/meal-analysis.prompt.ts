import {
  MEAL_ANALYSIS_DETAIL_MAX_LENGTH,
  MEAL_ANALYSIS_DISH_MAX_LENGTH,
  MEAL_ANALYSIS_HEADLINE_MAX_LENGTH,
  MEAL_ANALYSIS_ITEM_KINDS,
  MEAL_ANALYSIS_MAX_DISHES,
  MEAL_ANALYSIS_MAX_ITEMS,
  MEAL_ANALYSIS_POLARITIES,
} from '../schemas/meal-analysis.schema.js';

/**
 * 餐食分析提示词。
 *
 * 与 v1 的「识别菜品」提示词的本质区别：这里不再要求模型做成分分解或对照
 * 食物成分表，而是直接给出**区间 + 排序结论 + 机器维度**。热量只给区间，
 * 因为分量的不确定性决定了单值精度是假的。
 */
export function buildMealAnalysisSystemPrompt(languageLabel: string): string {
  return [
    'You analyze one meal photo for a personal health-tracking app.',
    'Describe only what is visibly in the photo; never invent hidden ingredients, portions, or exact weights.',
    'Energy intake cannot be measured from a photo: answer with a plausible kcal interval, never a single precise value.',
    'Order the findings by how much they matter to the eater, most important first.',
    'Findings are observations, not medical advice: do not diagnose, do not mention diseases, do not tell the user to start, stop, or change any medication.',
    'Use hedged, non-judgmental wording such as "偏多" / "偏少" instead of alarmist claims.',
    `Write every headline and detail in ${languageLabel}.`,
    'Return only structured output that matches the required schema.',
  ].join(' ');
}

export function buildMealAnalysisUserPrompt(languageLabel: string): string {
  const kinds = MEAL_ANALYSIS_ITEM_KINDS.join(' | ');
  const polarities = MEAL_ANALYSIS_POLARITIES.join(' | ');

  return [
    'Analyze the attached meal photo and return the structured result.',
    `calorieRange: the whole meal's plausible energy interval in kcal (min <= max). Use null only when the photo shows no food at all.`,
    `dishes: up to ${String(MEAL_ANALYSIS_MAX_DISHES)} visible dish or drink names, at most ${String(MEAL_ANALYSIS_DISH_MAX_LENGTH)} characters each. Put the staple food and the main dish first.`,
    `items: at most ${String(MEAL_ANALYSIS_MAX_ITEMS)} findings, ordered by importance. rank starts at 1 and increases by 1.`,
    `kind must be one of: ${kinds}.`,
    `polarity must be one of: ${polarities} (good = worth keeping, watch = worth attention, neutral = neither).`,
    `headline: at most ${String(MEAL_ANALYSIS_HEADLINE_MAX_LENGTH)} characters, a phrase the app can show next to the meal in a list.`,
    `detail: one sentence, at most ${String(MEAL_ANALYSIS_DETAIL_MAX_LENGTH)} characters, the actionable explanation.`,
    'facets: machine-readable levels for the dimensions you are confident about; omit the rest.',
    `Write the text in ${languageLabel}.`,
  ].join(' ');
}
