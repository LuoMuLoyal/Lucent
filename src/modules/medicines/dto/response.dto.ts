import type { z } from 'zod';

import { medicineDetailDataSchema } from './detail.dto.js';
import { medicineSearchDataSchema } from './search.dto.js';

/**
 * Response-body aliases for the medicine endpoints.
 *
 * The former classes were empty `extends` wrappers around the shared data
 * schemas; the wrapper class names are kept as stable component names for the
 * response registry, so both aliases point at the data schemas directly.
 */
export const medicineSearchResponseSchema = medicineSearchDataSchema;

export const medicineDetailResponseSchema = medicineDetailDataSchema;

/** Strongly typed body of `GET /medicines` (search). */
export type MedicineSearchResponseDto = z.infer<
  typeof medicineSearchResponseSchema
>;

/** Strongly typed body of `GET /medicines/:id` (detail). */
export type MedicineDetailResponseDto = z.infer<
  typeof medicineDetailResponseSchema
>;
