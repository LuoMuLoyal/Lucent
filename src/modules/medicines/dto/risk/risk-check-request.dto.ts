import { z } from 'zod';

/**
 * 加药前预检的可信药品库候选。客户端在「加入药箱」前提交待加药品的
 * source/id，服务端即时跑一次静态检查（不落库、不输出安全判断）。
 */
export const riskCheckCandidateSchema = z
  .object({
    source: z.enum(['cn', 'drugbank']).describe('候选药品所在的可信药品库来源'),
    id: z
      .string()
      .min(1, '候选药品 id 不能为空')
      .describe('候选药品在可信药品库中的 id'),
  })
  .strict();

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
    type: z.enum(['static', 'llm']).describe('Type of risk check to run'),
    candidate: riskCheckCandidateSchema
      .describe('加药前预检的可信药品库候选；仅 type=static 时允许；预检不落库')
      .optional(),
  })
  .strict();

/** Strongly typed candidate object accepted by `POST /medicines/risk-check`. */
export type RiskCheckCandidateDto = z.infer<typeof riskCheckCandidateSchema>;

/** Strongly typed body of `POST /medicines/risk-check`. */
export type RunRiskCheckDto = z.infer<typeof runRiskCheckSchema>;
