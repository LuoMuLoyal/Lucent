import { z } from 'zod';

export const adminAuditLogListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    actorUserId: z.uuid().optional(),
    action: z.string().trim().min(1).max(100).optional(),
    resourceType: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export type AdminAuditLogListQueryDto = z.infer<
  typeof adminAuditLogListQuerySchema
>;

export const adminAuditLogItemSchema = z
  .object({
    id: z.string(),
    actorUserId: z.string(),
    action: z.string(),
    resourceType: z.string().nullable(),
    resourceId: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();

export const adminAuditLogListResponseSchema = z
  .object({
    items: z.array(adminAuditLogItemSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    limit: z.number().int().positive().max(100),
  })
  .strict();

export type AdminAuditLogListResponseDto = z.infer<
  typeof adminAuditLogListResponseSchema
>;
