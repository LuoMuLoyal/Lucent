import { z } from 'zod';

/** 目录项：稳定码 + 按请求语言本地化的展示文案。 */
export const symptomCatalogItemSchema = z.object({
  code: z
    .string()
    .describe('Stable symptom code; the value stored in payload `symptom`.'),
  label: z.string().describe('Localized display label.'),
});

/**
 * 症状目录响应。
 *
 * 目录由后端定义「有哪些症状、什么顺序」，客户端据此渲染并用自有文案兜底，
 * 因此新增症状只改后端也可用。
 */
export const symptomCatalogResponseSchema = z.object({
  items: z.array(symptomCatalogItemSchema),
});

export type SymptomCatalogItemDto = z.infer<typeof symptomCatalogItemSchema>;
export type SymptomCatalogResponseDto = z.infer<
  typeof symptomCatalogResponseSchema
>;
