import { AdminRole, UserStatus } from '#generated/prisma/client.js';
import { z } from 'zod';

export const adminUserListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    q: z.string().trim().min(1).max(120).optional(),
    status: z.enum([UserStatus.active, UserStatus.suspended]).optional(),
  })
  .strict();

export type AdminUserListQueryDto = z.infer<typeof adminUserListQuerySchema>;

export const adminUserSummarySchema = z
  .object({
    id: z.string(),
    email: z.email(),
    nickname: z.string().nullable(),
    status: z.enum(UserStatus),
    emailVerified: z.boolean(),
    createdAt: z.iso.datetime(),
    lastLoginAt: z.iso.datetime().nullable(),
    adminRole: z.enum(AdminRole).nullable(),
  })
  .strict();

export type AdminUserSummaryDto = z.infer<typeof adminUserSummarySchema>;

export const adminUserListResponseSchema = z
  .object({
    items: z.array(adminUserSummarySchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    limit: z.number().int().positive().max(100),
  })
  .strict();

export type AdminUserListResponseDto = z.infer<
  typeof adminUserListResponseSchema
>;
