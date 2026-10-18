import { z } from 'zod';

/**
 * Query schema for `GET /api/v1/admin/data/:resource`.
 *
 * `q` searches the resource's registered `searchFields`; `userId` is the one
 * exposed equality filter (the user-detail tabs rely on it); `sort`/`order`
 * are validated against the resource's registered sortable columns in the
 * service, since that depends on the `:resource` path param.
 */
export const adminResourceListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    q: z.string().trim().min(1).max(200).optional(),
    userId: z.uuid().optional(),
    sort: z.string().trim().min(1).max(60).optional(),
    order: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

export type AdminResourceListQueryDto = z.infer<
  typeof adminResourceListQuerySchema
>;

/**
 * Write body for the generic create/update endpoints. The shape is
 * intentionally permissive here: the authoritative allowlist is the
 * resource's `writableFields` (enforced in `AdminDataService`), and Prisma
 * validates the values. Unknown columns are rejected before they reach Prisma.
 */
export const adminResourceWriteSchema = z.record(z.string(), z.unknown());

export type AdminResourceWriteDto = z.infer<typeof adminResourceWriteSchema>;

/** A single resource row — columns vary per resource, so the shape is open. */
export const adminResourceRowSchema = z.record(z.string(), z.unknown());

export const adminResourceListResponseSchema = z
  .object({
    items: z.array(adminResourceRowSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    limit: z.number().int().positive().max(100),
  })
  .strict();

export type AdminResourceListResponseDto = z.infer<
  typeof adminResourceListResponseSchema
>;
