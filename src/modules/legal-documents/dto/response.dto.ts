import { z } from 'zod';

/**
 * Standard Schema (zod 4) for one entry of the `GET /legal-documents` list.
 *
 * Replaces the former `LegalDocumentListItemDto` response class. Response
 * schemas intentionally carry no `.strict()` / `.default()` so outbound
 * parsing tolerates whatever the service layer produces.
 */
export const legalDocumentListItemSchema = z.object({
  docType: z.string().describe('Document type identifier used in URL paths.'),
  title: z.string(),
  updatedAt: z.string().describe('ISO-8601 timestamp of last update.'),
});

/** Strongly typed metadata item for the legal document list endpoint. */
export type LegalDocumentListItemDto = z.infer<
  typeof legalDocumentListItemSchema
>;

/**
 * Standard Schema (zod 4) for the `GET /legal-documents/:docType` response.
 *
 * Replaces the former `LegalDocumentDetailDto` response class.
 */
export const legalDocumentDetailSchema = z.object({
  docType: z.string().describe('Document type identifier used in URL paths.'),
  title: z.string(),
  content: z.string().describe('Markdown content of the document.'),
  updatedAt: z.string().describe('ISO-8601 timestamp of last update.'),
});

/** Strongly typed full legal document with Markdown content. */
export type LegalDocumentDetailDto = z.infer<typeof legalDocumentDetailSchema>;

/**
 * Standard Schema (zod 4) for the `GET /legal-documents` list response body.
 *
 * Replaces the former `LegalDocumentListDataDto` response class.
 */
export const legalDocumentListSchema = z.object({
  items: z.array(legalDocumentListItemSchema),
  updatedAt: z
    .string()
    .describe('ISO-8601 timestamp of the most recent document update.'),
});

/** Strongly typed response data for the list endpoint. */
export type LegalDocumentListDataDto = z.infer<typeof legalDocumentListSchema>;

/** Backwards-compatible response alias for the list endpoint. */
export type LegalDocumentListResponseDto = LegalDocumentListDataDto;

/** Backwards-compatible response alias for the detail endpoint. */
export type LegalDocumentDetailResponseDto = LegalDocumentDetailDto;
