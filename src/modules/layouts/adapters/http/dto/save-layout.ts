import { z } from 'zod';

/**
 * Standard Schema for `PUT /layouts/:surface`.
 *
 * ## Why `payload` is `record(unknown)` and not a typed layout
 *
 * The server deliberately does not understand the layout document. Modelling
 * components/order/size here would mean (a) two definitions of the format to
 * keep in sync and (b) a backend release for every client-side layout change.
 * The contract is only that it is a JSON object; the client owns the rest.
 *
 * `.passthrough()` semantics come for free with `z.record`: any key is kept, so
 * a formatter or future field never trips validation.
 */
export const saveLayoutSchema = z
  .object({
    /**
     * The layout version the client last read.
     *
     * - a number: conditional write; the server rejects a mismatch with 409.
     * - `null` / omitted: unconditional write (first save, or the client's
     *   offline queue replaying after a reconnect, which cannot know the
     *   current version).
     */
    ifVersion: z
      .number()
      .int()
      .min(1)
      .nullable()
      .optional()
      .transform((value) => value ?? null)
      .describe(
        'Version the client last read. Omit or send null for an unconditional write.',
      ),
    schemaVersion: z
      .number()
      .int()
      .min(1)
      .describe(
        'Shape version of `payload`; must be within the server-supported range.',
      ),
    payload: z
      .unknown()
      .describe(
        'Client-owned layout document. Stored verbatim; the server never interprets it. ' +
          'An object for page layouts, an array for tab_chrome.',
      )
      .refine(
        (value) => value !== undefined && value !== null,
        'payload is required',
      ),
  })
  .describe('Layout document to persist for one surface.');

export type SaveLayoutDto = z.infer<typeof saveLayoutSchema>;
