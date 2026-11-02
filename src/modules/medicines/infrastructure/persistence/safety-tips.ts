import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/index.js';
import { MedicinesCacheService } from '../cache/store.js';
import {
  type MedicineSafetyTipAdminInput,
  type MedicineSafetyTipAdminPatch,
  type MedicineSafetyTipAdminRow,
  type MedicineSafetyTipEditableRow,
  type MedicineSafetyTipRepositoryPort,
  type MedicineSafetyTipsSourcePort,
  type MedicineSafetyTipRow,
} from '../../application/ports/safety-tips.js';

const SAFETY_TIP_ADMIN_SELECT = {
  id: true,
  contentZh: true,
  contentEn: true,
  category: true,
  sortOrder: true,
  isActive: true,
  updatedAt: true,
} as const;

const SAFETY_TIP_EDITABLE_SELECT = {
  id: true,
  contentZh: true,
  contentEn: true,
  category: true,
  sortOrder: true,
  isActive: true,
} as const;

/**
 * The administration response schema types `updatedAt` as an ISO string, and
 * the serializer rejects a raw `Date` — so Prisma rows are converted here
 * rather than at the controller. The converted shape is also what goes into
 * audit metadata: Prisma's JSON column rejects a `Date`.
 */
function toAdminSafetyTip(row: {
  id: string;
  contentZh: string;
  contentEn: string;
  category: string;
  sortOrder: number;
  isActive: boolean;
  updatedAt: Date;
}): MedicineSafetyTipAdminRow {
  return { ...row, updatedAt: row.updatedAt.toISOString() };
}

/** Public read source for active safety tips, wrapped in the shared cache key. */
@Injectable()
export class MedicineSafetyTipsStore implements MedicineSafetyTipsSourcePort {
  constructor(
    private readonly cacheStore: MedicinesCacheService,
    private readonly prisma: PrismaService,
  ) {}

  async listActiveCached(): Promise<MedicineSafetyTipRow[]> {
    return this.cacheStore.getOrSetSafetyTips(async () => {
      const rows = await this.prisma.medicineSafetyTip.findMany({
        where: { isActive: true },
      });
      return rows.map((row) => ({
        id: row.id,
        contentZh: row.contentZh,
        contentEn: row.contentEn,
        category: row.category,
      }));
    });
  }
}

@Injectable()
export class MedicineSafetyTipsRepository implements MedicineSafetyTipRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async listAll(): Promise<MedicineSafetyTipAdminRow[]> {
    const rows = await this.prisma.medicineSafetyTip.findMany({
      select: SAFETY_TIP_ADMIN_SELECT,
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toAdminSafetyTip);
  }

  async create(
    input: MedicineSafetyTipAdminInput,
  ): Promise<MedicineSafetyTipAdminRow> {
    const created = await this.prisma.medicineSafetyTip.create({
      data: input,
      select: SAFETY_TIP_ADMIN_SELECT,
    });
    return toAdminSafetyTip(created);
  }

  async update(
    id: string,
    patch: MedicineSafetyTipAdminPatch,
  ): Promise<MedicineSafetyTipAdminRow | null> {
    const updated = await this.prisma.medicineSafetyTip.update({
      where: { id },
      data: Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      ),
      select: SAFETY_TIP_ADMIN_SELECT,
    });
    return toAdminSafetyTip(updated);
  }

  async findEditable(id: string): Promise<MedicineSafetyTipEditableRow | null> {
    return this.prisma.medicineSafetyTip.findUnique({
      where: { id },
      select: SAFETY_TIP_EDITABLE_SELECT,
    });
  }

  async remove(id: string): Promise<void> {
    await this.prisma.medicineSafetyTip.delete({ where: { id } });
  }
}
