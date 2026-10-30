import { z } from 'zod';

import { LAYOUT_SURFACES } from '../../../domain/layout/surface.js';

/** One surface's layout as returned over the wire. */
export const layoutResponseSchema = z
  .object({
    surface: z.string().describe('Surface identifier this layout belongs to.'),
    version: z
      .number()
      .int()
      .describe(
        'Optimistic-concurrency token. Send it back as `ifVersion` on the next write.',
      ),
    schemaVersion: z
      .number()
      .int()
      .describe('Shape version of `payload`, owned by the client.'),
    payload: z
      .record(z.string(), z.unknown())
      .describe(
        'Client-owned layout document. The server stores it verbatim and never interprets it.',
      ),
    updatedAt: z.string().describe('ISO-8601 timestamp of the last write.'),
  })
  .describe('One surface layout.');

export type LayoutResponseDto = z.infer<typeof layoutResponseSchema>;

/**
 * `GET /layouts` — every surface the user has a layout for.
 *
 * Keyed by surface rather than returned as an array so the client can look one
 * up without scanning. Surfaces with no row are absent, not null: the client
 * falls back to its built-in defaults for those.
 */
export const layoutListResponseSchema = z
  .object({
    surfaces: z
      .record(z.enum(LAYOUT_SURFACES), layoutResponseSchema)
      .describe(
        'Stored layouts keyed by surface. A missing surface means the user never customised it.',
      ),
  })
  .describe('All stored layouts of the authenticated user.');

export type LayoutListResponseDto = z.infer<typeof layoutListResponseSchema>;
