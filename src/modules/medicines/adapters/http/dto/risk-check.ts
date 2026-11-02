import { z } from 'zod';

import type { RiskCheckCandidateDto } from '../../../application/ports/risk-check.js';
import { MEDICINE_KNOWLEDGE_SOURCES } from '../../../domain/medicine/medicine-source.js';

/**
 * 加药前预检的可信药品库候选。客户端在「加入药箱」前提交待加药品的
 * source/id，服务端即时跑一次静态检查（不落库、不输出安全判断）。
 *
 * The application-layer contract is `RiskCheckCandidateDto`
 * (`application/ports/risk-check.ts`); this schema adds only the wire-level
 * rules and OpenAPI prose on top of it, so the use case never imports an
 * adapter DTO.
 */
export const riskCheckCandidateSchema = z
  .object({
    source: z
      .enum(MEDICINE_KNOWLEDGE_SOURCES)
      .describe('候选药品所在的可信药品库来源')
      .meta({ example: 'drugbank' }),
    id: z
      .string()
      .min(1, 'validation.field.required')
      .describe('候选药品在可信药品库中的 id')
      .meta({ example: 'DB01050' }),
  })
  .strict() satisfies z.ZodType<RiskCheckCandidateDto>;

/**
 * zod 4 Standard Schema for `POST /medicines/risk-check` body.
 *
 * Migrated from the former class-validator DTOs (class names preserved as
 * `z.infer` type aliases):
 * - `@IsEnum` → `z.enum(...)`;
 * - `@IsNotEmpty` → `.min(1)`;
 * - `@IsOptional` + `@ValidateNested` + `@Type(() => RiskCheckCandidateDto)`
 *   → the nested `riskCheckCandidateSchema` referenced directly;
 * - the global `forbidNonWhitelisted` behaviour (top level and nested) is
 *   preserved with `.strict()` on both schemas.
 */
export const runRiskCheckSchema = z
  .object({
    type: z
      .enum(['static', 'llm'])
      .describe('Type of risk check to run')
      .meta({ example: 'static' }),
    candidate: riskCheckCandidateSchema
      .describe('加药前预检的可信药品库候选；仅 type=static 时允许；预检不落库')
      .meta({ example: { source: 'drugbank', id: 'DB01050' } })
      .optional(),
  })
  .strict();

/**
 * The candidate contract is owned by the application layer
 * (`application/ports/risk-check.ts`); the wire schema above is checked to
 * produce exactly that type.
 */
export type { RiskCheckCandidateDto };

/** Strongly typed body of `POST /medicines/risk-check`. */
export type RunRiskCheckDto = z.infer<typeof runRiskCheckSchema>;
