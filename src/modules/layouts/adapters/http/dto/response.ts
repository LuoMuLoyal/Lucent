import { z } from 'zod';

/**
 * One surface's layout as returned over the wire.
 *
 * `updatedAt` is an ISO-8601 **string**, not a `Date`: the serialization layer
 * parses the handler's return value through this schema, and zod rejects a raw
 * `Date`. The controller converts (see `toWire`) — this file only states what
 * goes on the wire.
 *
 * Every field carries an `example`: the contract test
 * (`test/contract/openapi-metadata.e2e-spec.ts`) requires each 2xx JSON response
 * schema to be self-documenting, so generated clients get a usable sample.
 */
export const layoutResponseSchema = z
  .object({
    surface: z
      .string()
      .describe('Surface identifier this layout belongs to.')
      .meta({ example: 'today' }),
    version: z
      .number()
      .int()
      .describe(
        'Optimistic-concurrency token. Send it back as `ifVersion` on the next write.',
      )
      .meta({ example: 3 }),
    schemaVersion: z
      .number()
      .int()
      .describe('Shape version of `payload`, owned by the client.')
      .meta({ example: 1 }),
    /**
     * Any JSON value, not just an object.
     *
     * Page layouts are objects (`{ placements: [...] }`) but `tab_chrome`'s is
     * an array (`[{ tabId, customLabel, ... }]`). Constraining this to an
     * object would make the tab-preferences payload unsavable.
     */
    payload: z
      .unknown()
      .describe(
        'Client-owned layout document. The server stores it verbatim and never interprets it.',
      )
      .meta({
        example: {
          placements: [
            { id: 'summary.metrics', size: 'wide' },
            { id: 'water.trend', size: 'compact' },
          ],
        },
      }),
    updatedAt: z
      .string()
      .describe('ISO-8601 timestamp of the last write.')
      .meta({ example: '2026-10-30T12:00:00.000Z' }),
  })
  .describe('One surface layout.');

export type LayoutResponseDto = z.infer<typeof layoutResponseSchema>;

/**
 * `GET /layouts` — every surface the user has a layout for.
 *
 * Keyed by surface rather than returned as an array so the client can look one
 * up without scanning. Surfaces with no row are absent, not null: the client
 * falls back to its built-in defaults for those.
 *
 * The key is `z.string()` rather than an enum: unknown surfaces are filtered out
 * on read (so they never appear here), and an enum would make the response
 * schema reject the whole document if one ever slipped through — a read path
 * must not fail because of a row it was going to drop anyway.
 */
export const layoutListResponseSchema = z
  .object({
    surfaces: z
      .record(z.string(), layoutResponseSchema)
      .describe(
        'Stored layouts keyed by surface. A missing surface means the user never customised it.',
      )
      .meta({
        example: {
          today: {
            surface: 'today',
            version: 3,
            schemaVersion: 1,
            payload: { placements: [{ id: 'summary.metrics', size: 'wide' }] },
            updatedAt: '2026-10-30T12:00:00.000Z',
          },
        },
      }),
  })
  .describe('All stored layouts of the authenticated user.');

export type LayoutListResponseDto = z.infer<typeof layoutListResponseSchema>;
