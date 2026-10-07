import { Injectable } from '@nestjs/common';
import type { AdminRole } from '#generated/prisma/client.js';
import { PrismaService } from '../../../prisma/index.js';
import {
  ADMIN_ROLE_PERMISSIONS,
  hasAdminPermission,
  type AdminPermission,
} from '../constants/permissions.js';

@Injectable()
export class AdminAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async getRole(userId: string): Promise<AdminRole | null> {
    const admin = await this.prisma.adminUser.findUnique({
      where: { userId },
      select: { role: true },
    });
    return admin?.role ?? null;
  }

  async getIdentity(userId: string) {
    const admin = await this.prisma.adminUser.findUnique({
      where: { userId },
      select: {
        role: true,
        user: {
          select: { id: true, email: true, nickname: true, avatar: true },
        },
      },
    });
    if (admin === null) {
      return null;
    }

    return {
      ...admin.user,
      role: admin.role,
      permissions: [...ADMIN_ROLE_PERMISSIONS[admin.role]],
    };
  }

  can(role: AdminRole, permission: AdminPermission): boolean {
    return hasAdminPermission(role, permission);
  }
}
