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

interface SafetyTipAdminRow {
  id: string;
  contentZh: string;
  contentEn: string;
  category: string;
  sortOrder: number;
  isActive: boolean;
  updatedAt: Date;
}

/**
 * The administration response schema types `updatedAt` as an ISO string, and
 * the serializer rejects a raw `Date` — so Prisma rows are converted here
 * rather than at the controller. The converted shape is also what goes into
 * audit metadata: Prisma's JSON column rejects a `Date`.
 */
function toAdminSafetyTip(row: SafetyTipAdminRow) {
  return { ...row, updatedAt: row.updatedAt.toISOString() };
}

@Injectable()
export class SafetyTipsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly cacheAdmin: MedicinesCacheAdminService,
  ) {}

  async list() {
    const rows = await this.prisma.medicineSafetyTip.findMany({
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
    return rows.map(toAdminSafetyTip);
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
    const tip = toAdminSafetyTip(created);
    await unwrapResult(
      this.auditLog.log({
        userId: actorUserId,
        action: 'admin.content.safety_tip.create',
        resourceType: 'medicine_safety_tip',
        resourceId: tip.id,
        metadata: { before: null, after: tip },
      }),
    );
    await this.cacheAdmin.invalidateAll();
    return tip;
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
    const tip = toAdminSafetyTip(updated);
    await unwrapResult(
      this.auditLog.log({
        userId: actorUserId,
        action: 'admin.content.safety_tip.update',
        resourceType: 'medicine_safety_tip',
        resourceId: id,
        metadata: { before, after: tip },
      }),
    );
    await this.cacheAdmin.invalidateAll();
    return tip;
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
