import { z } from 'zod';

/**
 * Standard Schema (zod 4) for one entry of the `GET /legal` list.
 *
 * Replaces the former `LegalDocListItemDto` response class. Response
 * schemas intentionally carry no `.strict()` / `.default()` so outbound
 * parsing tolerates whatever the service layer produces.
 */
export const legalDocumentListItemSchema = z.object({
  docType: z.string().describe('Document type identifier used in URL paths.'),
  title: z.string(),
  updatedAt: z.string().describe('ISO-8601 timestamp of last update.'),
});

/** Strongly typed metadata item for the legal document list endpoint. */
export type LegalDocListItemDto = z.infer<
  typeof legalDocumentListItemSchema
>;

/**
 * Standard Schema (zod 4) for the `GET /legal/:docType` response.
 *
 * Replaces the former `LegalDocDetailDto` response class.
 */
export const legalDocumentDetailSchema = z.object({
  docType: z
    .string()
    .describe('Document type identifier used in URL paths.')
    .meta({ example: 'terms-of-service' }),
  title: z.string(),
  content: z.string().describe('Markdown content of the document.'),
  updatedAt: z.string().describe('ISO-8601 timestamp of last update.'),
});

/** Strongly typed full legal document with Markdown content. */
export type LegalDocDetailDto = z.infer<typeof legalDocumentDetailSchema>;

/**
 * Standard Schema (zod 4) for the `GET /legal` list response body.
 *
 * Replaces the former `LegalDocListDataDto` response class.
 */
export const legalDocumentListSchema = z.object({
  items: z.array(legalDocumentListItemSchema),
  updatedAt: z
    .string()
    .describe('ISO-8601 timestamp of the most recent document update.')
    .meta({ example: '2026-06-01T09:00:00.000Z' }),
});

/** Strongly typed response data for the list endpoint. */
export type LegalDocListDataDto = z.infer<typeof legalDocumentListSchema>;

/** Backwards-compatible response alias for the list endpoint. */
export type LegalDocListResponseDto = LegalDocListDataDto;

/** Backwards-compatible response alias for the detail endpoint. */
export type LegalDocDetailResponseDto = LegalDocDetailDto;
