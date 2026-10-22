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

/**
 * A single resource row — columns vary per resource, so the shape is open.
 *
 * The `example` is not decoration: the OpenAPI contract test requires every 2xx
 * body schema to carry an example or an explicit `nullable`, and an open record
 * has neither any described property nor a `$ref` to borrow metadata from.
 * The values mirror `users` so the generated docs stay concrete.
 */
export const adminResourceRowSchema = z
  .record(z.string(), z.unknown())
  .meta({ example: { id: 'usr_9f2c1e4a7b8d4c6e', email: 'a@example.com' } });

export const adminResourceListResponseSchema = z
  .object({
    items: z.array(adminResourceRowSchema),
    total: z.number().int().nonnegative().meta({ example: 1 }),
    page: z.number().int().positive().meta({ example: 1 }),
    limit: z.number().int().positive().max(100).meta({ example: 25 }),
  })
  .strict();

export type AdminResourceListResponseDto = z.infer<
  typeof adminResourceListResponseSchema
>;

/**
 * Query schema for `GET /api/v1/admin/users/:id/related`. `limit` bounds each
 * per-resource section (the user-detail tabs show a preview, then page through
 * `/admin/data/:resource?userId=...` for the full list).
 */
export const adminUserRelatedQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(10),
  })
  .strict();

export type AdminUserRelatedQueryDto = z.infer<
  typeof adminUserRelatedQuerySchema
>;

export const adminUserRelatedSectionSchema = z
  .object({
    resource: z.string(),
    items: z.array(adminResourceRowSchema),
    total: z.number().int().nonnegative(),
  })
  .strict();

export const adminUserRelatedGroupSchema = z
  .object({
    key: z.string(),
    sections: z.array(adminUserRelatedSectionSchema),
  })
  .strict();

export const adminUserRelatedResponseSchema = z
  .object({
    userId: z.string().meta({ example: 'usr_9f2c1e4a7b8d4c6e' }),
    groups: z.array(adminUserRelatedGroupSchema),
  })
  .strict();

export type AdminUserRelatedResponseDto = z.infer<
  typeof adminUserRelatedResponseSchema
>;
