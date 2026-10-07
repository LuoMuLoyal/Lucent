import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/index.js';
import { AuditLogService } from '../../audit-log/index.js';
import type { AuditLogEntry } from '../../audit-log/services/audit-log.service.js';
import { unwrapResult } from '../../../common/result/index.js';
import { LegalDocumentsService } from './documents.service.js';

export interface LegalDocumentAdminUpdate {
  titleZh?: string | undefined;
  titleEn?: string | undefined;
  contentZh?: string | undefined;
  contentEn?: string | undefined;
  isActive?: boolean | undefined;
}

@Injectable()
export class LegalDocumentsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly documents: LegalDocumentsService,
  ) {}

  async list() {
    return this.prisma.legalDocument.findMany({
      select: {
        docType: true,
        titleZh: true,
        titleEn: true,
        contentZh: true,
        contentEn: true,
        isActive: true,
        updatedAt: true,
      },
      orderBy: { docType: 'asc' },
    });
  }

  async update(
    actorUserId: string,
    docType: string,
    input: LegalDocumentAdminUpdate,
  ) {
    const before = await this.prisma.legalDocument.findUnique({
      where: { docType },
      select: {
        titleZh: true,
        titleEn: true,
        isActive: true,
        updatedAt: true,
      },
    });
    if (before === null) return null;

    const updated = await this.prisma.legalDocument.update({
      where: { docType },
      data: Object.fromEntries(
        Object.entries(input).filter(([, value]) => value !== undefined),
      ),
      select: {
        docType: true,
        titleZh: true,
        titleEn: true,
        contentZh: true,
        contentEn: true,
        isActive: true,
        updatedAt: true,
      },
    });

    const entry: AuditLogEntry = {
      userId: actorUserId,
      action: 'admin.content.legal_document.update',
      resourceType: 'legal_document',
      resourceId: docType,
      metadata: {
        changedFields: Object.keys(input),
        before: {
          titleZh: before.titleZh,
          titleEn: before.titleEn,
          isActive: before.isActive,
          updatedAt: before.updatedAt.toISOString(),
        },
        after: {
          titleZh: updated.titleZh,
          titleEn: updated.titleEn,
          isActive: updated.isActive,
          updatedAt: updated.updatedAt.toISOString(),
        },
      },
    };
    await this.documents.invalidateDocumentCache(docType);
    await unwrapResult(this.auditLog.log(entry));
    return updated;
  }
}
