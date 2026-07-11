import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  LegalDocumentDetailDto,
  LegalDocumentListDataDto,
  LegalDocumentListItemDto,
} from '../dto';
import type { LegalDocumentQueryDto } from '../dto';
import { DEFAULT_LEGAL_LANG, type LegalLang } from '../constants';

@Injectable()
export class LegalDocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    query: LegalDocumentQueryDto,
  ): Promise<LegalDocumentListDataDto> {
    const lang = this.resolveLang(query.lang);

    const rows = await this.prisma.legalDocument.findMany({
      where: { isActive: true },
      orderBy: { updatedAt: 'desc' },
    });

    const items: LegalDocumentListItemDto[] = rows.map((row) => ({
      docType: row.docType,
      title: lang === 'en' ? row.titleEn : row.titleZh,
      updatedAt: row.updatedAt.toISOString(),
    }));

    const latestRow = rows[0];
    const updatedAt = latestRow
      ? latestRow.updatedAt.toISOString()
      : new Date().toISOString();

    return { items, updatedAt };
  }

  async findOne(
    docType: string,
    query: LegalDocumentQueryDto,
  ): Promise<LegalDocumentDetailDto> {
    const lang = this.resolveLang(query.lang);

    const row = await this.prisma.legalDocument.findUnique({
      where: { docType },
    });

    if (!row || !row.isActive) {
      throw new NotFoundException(`Legal document '${docType}' not found`);
    }

    return {
      docType: row.docType,
      title: lang === 'en' ? row.titleEn : row.titleZh,
      content: lang === 'en' ? row.contentEn : row.contentZh,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private resolveLang(lang: string | undefined): LegalLang {
    return lang === 'en' ? 'en' : DEFAULT_LEGAL_LANG;
  }
}
