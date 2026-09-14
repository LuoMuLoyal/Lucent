/**
 * 症状严重度码 → 趋势判定用的分值。
 *
 * 线上词汇与 health_context 的过敏严重度一致：`mild` / `moderate` / `severe` / `unknown`。
 * `unknown`（用户明确判断不了）以及任何未知值一律返回 `null` —— 调用方必须把它当作
 * 「本条无观测」跳过，**绝不回落成最小严重度**，否则「症状恶化趋势」会把"说不清"读成"很轻"。
 */
const SYMPTOM_SEVERITY_SCORES: Record<string, number> = {
  mild: 1,
  moderate: 2,
  severe: 3,
};

export function symptomSeverityScore(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null;
  }
  return SYMPTOM_SEVERITY_SCORES[value] ?? null;
}
