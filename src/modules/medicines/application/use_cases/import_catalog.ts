import { Injectable } from '@nestjs/common';
import { Prisma } from '#generated/prisma/client.js';
import { PrismaService } from '../../../../prisma/index.js';
import { unwrapResult } from '../../../../common/result/index.js';
import { MedicinesCacheAdminService } from './rebuild_index.js';
import { AuditLogService } from '../../../audit-log/index.js';

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

/** Editorial fields of one QA corpus row that the admin surface may change. */
export interface QaChunkAdminInput {
  question: string;
  answer: string;
  safetyLabel: string;
}

export type QaChunkAdminPatch = {
  [Key in keyof QaChunkAdminInput]?: QaChunkAdminInput[Key] | undefined;
};

export interface QaChunkAdminListQuery {
  page: number;
  limit: number;
  q?: string | undefined;
  safetyLabel?: string | undefined;
}

interface QaChunkAdminRow {
  id: string;
  qaId: string;
  question: string;
  answer: string;
  safetyLabel: string;
  updatedAt: Date;
}

/**
 * `qaId` is the corpus identity (`qa:<qaId>:0` in the retrieval index) and is
 * assigned by the import script, so it is neither listed as editable here nor
 * part of `QaChunkAdminPatch`; the generic `data:write` layer still allows a
 * super administrator to change it.
 */
const QA_CHUNK_ADMIN_SELECT = {
  id: true,
  qaId: true,
  question: true,
  answer: true,
  safetyLabel: true,
  updatedAt: true,
} satisfies Prisma.MedicalQaChunkSelect;

const QA_CHUNK_ADMIN_BEFORE_SELECT = {
  id: true,
  qaId: true,
  question: true,
  answer: true,
  safetyLabel: true,
} satisfies Prisma.MedicalQaChunkSelect;

function toAdminQaChunk(row: QaChunkAdminRow) {
  return { ...row, updatedAt: row.updatedAt.toISOString() };
}

/**
 * Owner service for the assistant's open medical Q&A corpus
 * (`medical_qa_chunks`), exposed to the admin console through the
 * `content:read`/`content:write` surface.
 *
 * Two operational caveats the console surfaces but cannot enforce here:
 * the corpus is retrieved through the LightRAG `qa` workspace built by
 * `scripts/import/medicine/rebuild-lightrag-index.ts`, so an edit only reaches
 * retrieval after a rebuild; and a re-import of the source corpus overwrites
 * the row. Rows whose `safetyLabel` is `blocked` are skipped at index time.
 */
@Injectable()
export class QaChunksAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async list(query: QaChunkAdminListQuery) {
    const where: Prisma.MedicalQaChunkWhereInput = {};
    if (query.safetyLabel !== undefined) {
      where.safetyLabel = query.safetyLabel;
    }
    if (query.q !== undefined) {
      where.OR = [
        { qaId: { contains: query.q, mode: 'insensitive' } },
        { question: { contains: query.q, mode: 'insensitive' } },
        { answer: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.medicalQaChunk.findMany({
        where,
        select: QA_CHUNK_ADMIN_SELECT,
        orderBy: [{ qaId: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.medicalQaChunk.count({ where }),
    ]);
    return {
      items: rows.map(toAdminQaChunk),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async update(actorUserId: string, id: string, input: QaChunkAdminPatch) {
    const before = await this.prisma.medicalQaChunk.findUnique({
      where: { id },
      select: QA_CHUNK_ADMIN_BEFORE_SELECT,
    });
    if (before === null) return null;
    const updated = await this.prisma.medicalQaChunk.update({
      where: { id },
      data: Object.fromEntries(
        Object.entries(input).filter(([, value]) => value !== undefined),
      ),
      select: QA_CHUNK_ADMIN_SELECT,
    });
    const chunk = toAdminQaChunk(updated);
    await unwrapResult(
      this.auditLog.log({
        userId: actorUserId,
        action: 'admin.content.qa_chunk.update',
        resourceType: 'medical_qa_chunk',
        resourceId: id,
        metadata: { before, after: chunk },
      }),
    );
    return chunk;
  }
}
