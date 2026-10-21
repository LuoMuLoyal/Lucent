import { Injectable } from '@nestjs/common';
import { Prisma } from '#generated/prisma/client.js';
import { PrismaService } from '../../../../prisma/index.js';
import {
  type QaChunkAdminListQuery,
  type QaChunkAdminPatch,
  type QaChunkAdminRow,
  type QaChunkRepositoryPort,
} from '../../application/ports/qa_chunks.js';

/** Editorial fields of one QA corpus row that the admin surface may change. */
type QaChunkRawRow = {
  id: string;
  qaId: string;
  question: string;
  answer: string;
  safetyLabel: string;
  updatedAt: Date;
};

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

function toAdminQaChunk(row: QaChunkRawRow): QaChunkAdminRow {
  return { ...row, updatedAt: row.updatedAt.toISOString() };
}

@Injectable()
export class MedicalQaChunksRepository implements QaChunkRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: QaChunkAdminListQuery): Promise<{
    items: QaChunkAdminRow[];
    total: number;
  }> {
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
    };
  }

  async findEditable(id: string) {
    return this.prisma.medicalQaChunk.findUnique({
      where: { id },
      select: QA_CHUNK_ADMIN_BEFORE_SELECT,
    });
  }

  async update(
    id: string,
    patch: QaChunkAdminPatch,
  ): Promise<QaChunkAdminRow | null> {
    const updated = await this.prisma.medicalQaChunk.update({
      where: { id },
      data: Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      ),
      select: QA_CHUNK_ADMIN_SELECT,
    });
    return toAdminQaChunk(updated);
  }
}
