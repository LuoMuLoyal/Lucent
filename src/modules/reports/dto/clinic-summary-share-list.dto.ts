import { z } from 'zod';
import { clinicSummaryShareScopeSchema } from './clinic-summary-response.dto.js';

/**
 * Share-management list response schemas.
 *
 * Each item is the shaped read model of one persisted share — the plaintext
 * token is returned exactly once at creation and never persisted, so the list
 * payload deliberately carries no token/tokenHash field at any level.
 *
 * Each schema replaces the former `@ApiProperty` response class of the same
 * name (minus the `Schema` suffix).
 */

/** Replaces `ClinicSummaryShareListItemDto`. */
export const clinicSummaryShareListItemSchema = z.object({
  id: z
    .string()
    .describe(
      'Persisted share record id (used for revocation). Never a token.',
    ),
  createdAt: z.string().describe('Creation time in ISO 8601 format.'),
  expiresAt: z.string().describe('Expiration time in ISO 8601 format.'),
  revokedAt: z
    .string()
    .nullable()
    .describe(
      'Revocation time in ISO 8601 format, or null while the share is active.',
    ),
  accessCount: z.number().describe('Number of successful public opens.'),
  firstAccessedAt: z
    .string()
    .nullable()
    .describe(
      'First access time in ISO 8601 format, or null when never opened.',
    ),
  lastAccessedAt: z
    .string()
    .nullable()
    .describe(
      'Last access time in ISO 8601 format, or null when never opened.',
    ),
  scope: clinicSummaryShareScopeSchema,
  selectedFields: z
    .array(z.string())
    .describe('Share fields the link may expose.'),
});

/** Strongly typed share-list item of the share-management payload. */
export type ClinicSummaryShareListItemDto = z.infer<
  typeof clinicSummaryShareListItemSchema
>;

/** Replaces `ClinicSummaryShareListDataDto`. */
export const clinicSummaryShareListDataSchema = z.object({
  items: z
    .array(clinicSummaryShareListItemSchema)
    .describe(
      'The caller shares, newest first (createdAt desc); revoked shares stay listed.',
    ),
});

/** Strongly typed share-management list payload. */
export type ClinicSummaryShareListDataDto = z.infer<
  typeof clinicSummaryShareListDataSchema
>;

/**
 * Response schema of `GET /reports/clinic-summary/shares` — wire-identical to
 * {@link clinicSummaryShareListDataSchema}. Replaces the former response
 * class `ClinicSummaryShareListResponseDto` (which extended
 * `ClinicSummaryShareListDataDto` without adding fields).
 */
export const clinicSummaryShareListResponseSchema =
  clinicSummaryShareListDataSchema;

/** Strongly typed share-management list response body. */
export type ClinicSummaryShareListResponseDto = z.infer<
  typeof clinicSummaryShareListResponseSchema
>;
