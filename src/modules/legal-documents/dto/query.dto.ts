import { z } from 'zod';
import { LEGAL_LANGS } from '../constants/legal.constants.js';

/**
 * Standard Schema (zod 4) for the legal-documents list/detail query params.
 *
 * Replaces the former class-validator DTO:
 * - `@IsOptional` + `@IsString` → `.optional()` string handling;
 * - `@IsIn([...LEGAL_LANGS])` → `z.enum(LEGAL_LANGS)`;
 * - the global `forbidNonWhitelisted` behaviour is preserved with `.strict()`
 *   (unknown query keys are rejected).
 */
export const legalDocumentQuerySchema = z
  .object({
    lang: z
      .enum(LEGAL_LANGS)
      .describe("Content language: 'zh' or 'en'. Default: 'zh'.")
      .optional(),
  })
  .strict();

/** Strongly typed query object of the legal-document endpoints. */
export type LegalDocumentQueryDto = z.infer<typeof legalDocumentQuerySchema>;
