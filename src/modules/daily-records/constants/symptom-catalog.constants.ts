/**
 * 症状目录（线上契约）。
 *
 * 顺序即客户端快速记录里的展示顺序；码是最稳定的标识——记录 payload 的
 * `symptom` 写码，客户端偏好里「启用了哪些症状」也存码，因此换语言不会失效。
 * 文案不进这里：目录端点用 `src/i18n/{zh-CN,en}/symptom-catalog.json` 按
 * `Accept-Language` 本地化。
 *
 * 客户端的兜底副本（`Luminous` 的 `domain/constants/symptom_catalog.dart`）必须与
 * 本清单同码；新增症状时两边一起改。
 */
export const SYMPTOM_CATALOG_CODES = [
  'headache',
  'stomachache',
  'dizzy',
  'fever',
  'nausea',
  'cough',
  'fatigue',
  'insomnia',
  'other',
] as const;

export type SymptomCatalogCode = (typeof SYMPTOM_CATALOG_CODES)[number];
