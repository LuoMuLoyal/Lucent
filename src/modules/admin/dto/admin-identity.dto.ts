import { z } from 'zod';
import { AdminRole } from '#generated/prisma/client.js';
import { ADMIN_PERMISSIONS } from '../constants/permissions.js';

export const adminIdentityResponseSchema = z
  .object({
    id: z.string(),
    email: z.email(),
    nickname: z.string().nullable(),
    avatar: z.string().nullable(),
    role: z.enum(AdminRole),
    permissions: z.array(z.enum(ADMIN_PERMISSIONS)),
  })
  .strict();

export type AdminIdentityDto = z.infer<typeof adminIdentityResponseSchema>;
