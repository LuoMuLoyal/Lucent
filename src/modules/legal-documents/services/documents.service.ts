import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
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
  private static readonly LIST_TTL_MS = 60 * 60 * 1000; // 1 hour
  private static readonly DETAIL_TTL_MS = 60 * 60 * 1000; // 1 hour

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async findAll(
    query: LegalDocumentQueryDto,
  ): Promise<LegalDocumentListDataDto> {
    const lang = this.resolveLang(query.lang);
    const cacheKey = `legal-documents:list:${lang}`;

    const cached = await this.cache.get<LegalDocumentListDataDto>(cacheKey);
    if (cached != null) {
      return cached;
    }

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

    const result = { items, updatedAt };
    await this.cache.set(cacheKey, result, LegalDocumentsService.LIST_TTL_MS);
    return result;
  }

  async findOne(
    docType: string,
    query: LegalDocumentQueryDto,
  ): Promise<LegalDocumentDetailDto> {
    const lang = this.resolveLang(query.lang);
    const cacheKey = `legal-documents:detail:${docType}:${lang}`;

    const cached = await this.cache.get<LegalDocumentDetailDto>(cacheKey);
    if (cached != null) {
      return cached;
    }

    const row = await this.prisma.legalDocument.findUnique({
      where: { docType },
    });

    if (!row || !row.isActive) {
      throw new NotFoundException(`Legal document '${docType}' not found`);
    }

    const result = {
      docType: row.docType,
      title: lang === 'en' ? row.titleEn : row.titleZh,
      content: lang === 'en' ? row.contentEn : row.contentZh,
      updatedAt: row.updatedAt.toISOString(),
    };

    await this.cache.set(cacheKey, result, LegalDocumentsService.DETAIL_TTL_MS);
    return result;
  }

  private resolveLang(lang: string | undefined): LegalLang {
    return lang === 'en' ? 'en' : DEFAULT_LEGAL_LANG;
  }
}
