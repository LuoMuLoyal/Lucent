import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../../../prisma/index.js';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../common/result/index.js';
import type {
  LegalDocDetailDto,
  LegalDocListDataDto,
  LegalDocListItemDto,
} from '../dto/response.dto.js';
import type { LegalDocQueryDto } from '../dto/query.dto.js';
import {
  DEFAULT_LEGAL_LANG,
  type LegalLang,
} from '../constants/legal.constants.js';

@Injectable()
export class LegalService {
  private static readonly LIST_TTL_MS = 60 * 60 * 1000; // 1 hour
  private static readonly DETAIL_TTL_MS = 60 * 60 * 1000; // 1 hour
  private static readonly LIST_CACHE_KEY_PREFIX = 'legal:list';
  private static readonly DETAIL_CACHE_KEY_PREFIX = 'legal:detail';

  private readonly logger = new Logger(LegalService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  /**
   * Lists all active legal documents.
   *
   * The cache is a pure acceleration layer — the database is the source of
   * truth. A cache read/write failure is therefore best-effort: it is logged
   * as a warning and the request is served from the database instead of
   * failing. Only a database failure propagates (unknown DB errors rethrow
   * to the global filter).
   */
  findAll(
    query: LegalDocQueryDto,
  ): ResultAsync<LegalDocListDataDto, DomainFailure> {
    const lang = this.resolveLang(query.lang);
    const cacheKey = `${LegalService.LIST_CACHE_KEY_PREFIX}:${lang}`;

    return fromPromise(
      this.readCache<LegalDocListDataDto>(cacheKey, 'list read'),
      (error) => {
        throw error;
      },
    ).andThen((cached) => {
      if (cached != null) {
        return okAsync(cached);
      }

      return fromPromise(
        this.prisma.legalDocument.findMany({
          where: { isActive: true },
          orderBy: { updatedAt: 'desc' },
        }),
        (error) => {
          throw error;
        },
      ).map((rows) => {
        const items: LegalDocListItemDto[] = rows.map((row) => ({
          docType: row.docType,
          title: lang === 'en' ? row.titleEn : row.titleZh,
          updatedAt: row.updatedAt.toISOString(),
        }));

        const latestRow = rows[0];
        const updatedAt = latestRow
          ? latestRow.updatedAt.toISOString()
          : new Date().toISOString();

        const result = { items, updatedAt };
        // Best-effort cache write — a failed write must not fail the read.
        this.writeCache(
          cacheKey,
          result,
          LegalService.LIST_TTL_MS,
          'list write',
        );
        return result;
      });
    });
  }

  /**
   * Gets a specific active legal document by type.
   *
   * Missing or inactive documents map to `LEGAL_DOCUMENT_NOT_FOUND` (404);
   * cache failures are best-effort (see `findAll`).
   */
  findOne(
    docType: string,
    query: LegalDocQueryDto,
  ): ResultAsync<LegalDocDetailDto, DomainFailure> {
    const lang = this.resolveLang(query.lang);
    const cacheKey = `${LegalService.DETAIL_CACHE_KEY_PREFIX}:${docType}:${lang}`;

    return fromPromise(
      this.readCache<LegalDocDetailDto>(cacheKey, 'detail read'),
      (error) => {
        throw error;
      },
    ).andThen((cached) => {
      if (cached != null) {
        return okAsync(cached);
      }

      return fromPromise(
        this.prisma.legalDocument.findUnique({ where: { docType } }),
        (error) => {
          throw error;
        },
      ).andThen((row) => {
        if (!row || !row.isActive) {
          return errAsync(this.documentNotFound());
        }

        const result = {
          docType: row.docType,
          title: lang === 'en' ? row.titleEn : row.titleZh,
          content: lang === 'en' ? row.contentEn : row.contentZh,
          updatedAt: row.updatedAt.toISOString(),
        };

        // Best-effort cache write — a failed write must not fail the read.
        this.writeCache(
          cacheKey,
          result,
          LegalService.DETAIL_TTL_MS,
          'detail write',
        );
        return okAsync(result);
      });
    });
  }

  async invalidateDocumentCache(docType: string): Promise<void> {
    const keys = [
      `${LegalService.LIST_CACHE_KEY_PREFIX}:zh`,
      `${LegalService.LIST_CACHE_KEY_PREFIX}:en`,
      `${LegalService.DETAIL_CACHE_KEY_PREFIX}:${docType}:zh`,
      `${LegalService.DETAIL_CACHE_KEY_PREFIX}:${docType}:en`,
    ];
    await Promise.all(
      keys.map(async (key) => {
        try {
          await this.cache.del(key);
        } catch (error) {
          this.logCacheFailure(`invalidate ${key}`, error);
        }
      }),
    );
  }

  private resolveLang(lang: string | undefined): LegalLang {
    return lang === 'en' ? 'en' : DEFAULT_LEGAL_LANG;
  }

  private documentNotFound(): DomainFailure {
    return createDomainFailure({
      kind: 'not_found',
      code: 'LEGAL_DOCUMENT_NOT_FOUND',
    });
  }

  /**
   * Reads the cache, treating any store failure as a miss (the database is
   * the source of truth). Never rejects.
   */
  private async readCache<T>(
    cacheKey: string,
    phase: string,
  ): Promise<T | undefined> {
    try {
      return await this.cache.get<T>(cacheKey);
    } catch (error) {
      this.logCacheFailure(phase, error);
      return undefined;
    }
  }

  /**
   * Writes the cache best-effort — a failed write only logs a warning and
   * never affects the response.
   */
  private writeCache(
    cacheKey: string,
    value: unknown,
    ttl: number,
    phase: string,
  ): void {
    this.cache.set(cacheKey, value, ttl).catch((error: unknown) => {
      this.logCacheFailure(phase, error);
    });
  }

  private logCacheFailure(phase: string, error: unknown): void {
    this.logger.warn(
      `Legal documents cache ${phase} failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
