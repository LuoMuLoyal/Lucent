import { z } from 'zod';

import { MEDICINE_KNOWLEDGE_SOURCES } from './source.dto.js';

/**
 * zod 4 Standard Schema for the medicine search response body
 * (`GET /medicines`).
 *
 * Migrated from the former `@ApiProperty` response classes (class names kept
 * as `z.infer` type aliases; descriptions preserved via `.describe`).
 * No `.strict()` / `.default()` — outbound validation accepts the wire shape
 * produced by the search adapters.
 */

export const medicineSearchItemSchema = z.object({
  id: z.string().describe('Stable medicine id.'),
  source: z.enum(MEDICINE_KNOWLEDGE_SOURCES).describe('Knowledge source.'),
  name: z.string().describe('Display name.'),
  subtitle: z.string().nullable().describe('Short supporting subtitle.'),
  summary: z.string().nullable().describe('Short preview summary.'),
  tags: z.array(z.string()).describe('Compact tags for search cards.'),
  imageUrl: z.string().nullable().describe('Optional image URL.'),
  matchedBy: z
    .array(z.string())
    .describe('Which fields matched the current query.'),
});

export const medicinePaginationSchema = z.object({
  page: z.number().describe('Page number, 1-based.'),
  pageSize: z.number().describe('Page size.'),
  total: z.number().describe('Total result count.'),
  totalPages: z.number().describe('Total page count.'),
});

export const medicineSearchDataSchema = z.object({
  items: z.array(medicineSearchItemSchema).describe('Matched medicine items.'),
  pagination: medicinePaginationSchema.describe('Pagination metadata.'),
});

/** Strongly typed search result item. */
export type MedicineSearchItemDto = z.infer<typeof medicineSearchItemSchema>;

/** Pagination metadata of a search result. */
export type MedicinePaginationDto = z.infer<typeof medicinePaginationSchema>;

/** Strongly typed search data payload (items + pagination). */
export type MedicineSearchDataDto = z.infer<typeof medicineSearchDataSchema>;

export interface MedicinePagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface MedicineSearchResult {
  items: MedicineSearchItemDto[];
  pagination: MedicinePagination;
}
