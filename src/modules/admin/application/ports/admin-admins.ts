import { AdminRole, UserStatus } from '#generated/prisma/client.js';
import { z } from 'zod';

/**
 * One administrator grant: the target user's identity plus the role assigned in
 * `admin_users`. Mirrors `AdminConsoleService` shapes — dates are ISO strings.
 */
export const adminAdminSummarySchema = z
  .object({
    userId: z.string(),
    email: z.email(),
    nickname: z.string().nullable(),
    userStatus: z.enum(UserStatus),
    role: z.enum(AdminRole),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export type AdminAdminSummaryDto = z.infer<typeof adminAdminSummarySchema>;

export const adminAdminListResponseSchema = z
  .object({
    items: z.array(adminAdminSummarySchema),
    total: z.number().int().nonnegative(),
  })
  .strict();

export type AdminAdminListResponseDto = z.infer<
  typeof adminAdminListResponseSchema
>;

export const adminAdminRoleUpdateSchema = z
  .object({
    role: z.enum(AdminRole),
  })
  .strict();

export type AdminAdminRoleUpdateDto = z.infer<typeof adminAdminRoleUpdateSchema>;
