import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/index.js';
import { unwrapResult } from '../../../common/result/index.js';
import { MedicinesCacheAdminService } from '../cache/admin.service.js';
import { AuditLogService } from '../../audit-log/index.js';

export interface SafetyTipAdminInput {
  contentZh: string;
  contentEn: string;
  category: string;
  sortOrder: number;
  isActive: boolean;
}

type SafetyTipAdminPatch = {
  [Key in keyof SafetyTipAdminInput]?: SafetyTipAdminInput[Key] | undefined;
};

@Injectable()
export class SafetyTipsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly cacheAdmin: MedicinesCacheAdminService,
  ) {}

  list() {
    return this.prisma.medicineSafetyTip.findMany({
      select: {
        id: true,
        contentZh: true,
        contentEn: true,
        category: true,
        sortOrder: true,
        isActive: true,
        updatedAt: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
  }

  async create(actorUserId: string, input: SafetyTipAdminInput) {
    const created = await this.prisma.medicineSafetyTip.create({
      data: input,
      select: {
        id: true,
        contentZh: true,
        contentEn: true,
        category: true,
        sortOrder: true,
        isActive: true,
        updatedAt: true,
      },
    });
    await unwrapResult(
      this.auditLog.log({
        userId: actorUserId,
        action: 'admin.content.safety_tip.create',
        resourceType: 'medicine_safety_tip',
        resourceId: created.id,
        metadata: { before: null, after: created },
      }),
    );
    await this.cacheAdmin.invalidateAll();
    return created;
  }

  async update(actorUserId: string, id: string, input: SafetyTipAdminPatch) {
    const before = await this.prisma.medicineSafetyTip.findUnique({
      where: { id },
      select: {
        id: true,
        contentZh: true,
        contentEn: true,
        category: true,
        sortOrder: true,
        isActive: true,
      },
    });
    if (before === null) return null;
    const updated = await this.prisma.medicineSafetyTip.update({
      where: { id },
      data: Object.fromEntries(
        Object.entries(input).filter(([, value]) => value !== undefined),
      ),
      select: {
        id: true,
        contentZh: true,
        contentEn: true,
        category: true,
        sortOrder: true,
        isActive: true,
        updatedAt: true,
      },
    });
    await unwrapResult(
      this.auditLog.log({
        userId: actorUserId,
        action: 'admin.content.safety_tip.update',
        resourceType: 'medicine_safety_tip',
        resourceId: id,
        metadata: { before, after: updated },
      }),
    );
    await this.cacheAdmin.invalidateAll();
    return updated;
  }

  async remove(actorUserId: string, id: string) {
    const before = await this.prisma.medicineSafetyTip.findUnique({
      where: { id },
      select: {
        id: true,
        contentZh: true,
        contentEn: true,
        category: true,
        sortOrder: true,
        isActive: true,
      },
    });
    if (before === null) return false;
    await this.prisma.medicineSafetyTip.delete({ where: { id } });
    await unwrapResult(
      this.auditLog.log({
        userId: actorUserId,
        action: 'admin.content.safety_tip.delete',
        resourceType: 'medicine_safety_tip',
        resourceId: id,
        metadata: { before, after: null },
      }),
    );
    await this.cacheAdmin.invalidateAll();
    return true;
  }
}
