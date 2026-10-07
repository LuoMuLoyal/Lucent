import { Injectable } from '@nestjs/common';
import type { AdminRole } from '#generated/prisma/client.js';
import { PrismaService } from '../../../prisma/index.js';
import {
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

  can(role: AdminRole, permission: AdminPermission): boolean {
    return hasAdminPermission(role, permission);
  }
}
