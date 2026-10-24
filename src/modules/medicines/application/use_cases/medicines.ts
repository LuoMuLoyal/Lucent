import { Inject, Injectable, Logger } from '@nestjs/common';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { I18nService } from 'nestjs-i18n';

import { shuffleArray, safeParseLlmJson } from '../../../../common/index.js';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';
import {
  CN_MEDICINES_READER,
  DRUGBANK_MEDICINES_READER,
  MEDICINES_KNOWLEDGE_CACHE,
  type MedicineDetailDataLike,
  type MedicineSearchCriteria,
  type MedicineSearchResultLike,
  type MedicinesKnowledgeCachePort,
  type MedicinesSourceReader,
} from '../ports/knowledge.js';
import {
  MEDICINE_SAFETY_TIPS_SOURCE,
  type MedicineSafetyTipItem,
  type MedicineSafetyTipsSourcePort,
} from '../ports/safety-tips.js';
import {
  DEFAULT_MEDICINE_SOURCE,
  type MedicineKnowledgeSource,
} from '../../domain/medicine/medicine-source.js';
import { LlmRuntimeService } from '../../../../llm-runtime/index.js';

export type MedicineRecognitionFields = {
  name: string | null;
  approvalNumber: string | null;
  specification: string | null;
  manufacturer: string | null;
};

@Injectable()
export class MedicinesService {
  private static readonly SAFETY_TIPS_LIMIT = 4;

  private readonly logger = new Logger(MedicinesService.name);

  constructor(
    @Inject(DRUGBANK_MEDICINES_READER)
    private readonly drugbankMedicinesService: MedicinesSourceReader<MedicineDetailDataLike>,
    @Inject(CN_MEDICINES_READER)
    private readonly cnMedicinesService: MedicinesSourceReader<MedicineDetailDataLike>,
    @Inject(MEDICINES_KNOWLEDGE_CACHE)
    private readonly medicinesCacheService: MedicinesKnowledgeCachePort,
    @Inject(MEDICINE_SAFETY_TIPS_SOURCE)
    private readonly safetyTipsSource: MedicineSafetyTipsSourcePort,
    private readonly i18n: I18nService,
    private readonly llmRuntime: LlmRuntimeService,
  ) {}

  async recognizeMedicine(
    imageUrl: string,
  ): Promise<MedicineRecognitionFields> {
    const model = this.llmRuntime.createChatModel('chat', {
      temperature: 0.1,
    });

    const response = await model.invoke([
      new SystemMessage(this.i18n.t('medicine.recognize_prompt')),
      new HumanMessage({
        content: [
          {
            type: 'text',
            text: this.i18n.t('medicine.recognize_user_message'),
          },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      }),
    ]);

    const text =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

    const parsed = safeParseLlmJson(text, {
      logger: this.logger,
      context: 'medicine recognition',
    }) as MedicineRecognitionFields | null;

    return (
      parsed ?? {
        name: null,
        approvalNumber: null,
        specification: null,
        manufacturer: null,
      }
    );
  }

  search(query: {
    q?: string | undefined;
    page: number;
    pageSize: number;
    source?: string | undefined;
  }): ResultAsync<MedicineSearchResultLike, DomainFailure> {
    return this.searchWithCache(query, false);
  }

  searchWithCache(
    query: {
      q?: string | undefined;
      page: number;
      pageSize: number;
      source?: string | undefined;
    },
    bypassCache: boolean,
  ): ResultAsync<MedicineSearchResultLike, DomainFailure> {
    return this.resolveSource(query.source).andThen((source) => {
      const criteria: MedicineSearchCriteria = {
        q: query.q?.trim() ?? '',
        page: query.page,
        pageSize: query.pageSize,
      };

      return fromPromise(
        this.medicinesCacheService.getOrSetSearch(
          {
            source,
            ...criteria,
          },
          bypassCache,
          () =>
            source === 'drugbank'
              ? this.drugbankMedicinesService.search(criteria)
              : this.cnMedicinesService.search(criteria),
        ),
        (error) =>
          createDomainFailure({
            kind: 'internal',
            code: 'INTERNAL_ERROR',
            cause: error instanceof Error ? error : undefined,
          }),
      );
    });
  }

  getDetail(
    id: string,
    query: { source?: string | undefined },
  ): ResultAsync<MedicineDetailDataLike, DomainFailure> {
    return this.getDetailWithCache(id, query, false);
  }

  getDetailWithCache(
    id: string,
    query: { source?: string | undefined },
    bypassCache: boolean,
  ): ResultAsync<MedicineDetailDataLike, DomainFailure> {
    return this.resolveSource(query.source).andThen((source) => {
      const normalizedId = id.trim();

      return fromPromise(
        this.medicinesCacheService.getOrSetDetail(
          source,
          normalizedId,
          bypassCache,
          () =>
            source === 'drugbank'
              ? this.drugbankMedicinesService.getDetail(normalizedId)
              : this.cnMedicinesService.getDetail(normalizedId),
        ),
        (error) =>
          createDomainFailure({
            kind: 'internal',
            code: 'INTERNAL_ERROR',
            cause: error instanceof Error ? error : undefined,
          }),
      ).andThen((detail) => this.ensureFound(detail));
    });
  }

  /**
   * Sequences for one medicine.
   *
   * Only DrugBank carries sequences: the CN product source is a leaflet
   * database with no sequence columns, so it answers with an empty set rather
   * than a 404 — the medicine itself does exist.
   */
  getSequences(
    id: string,
    query: { source?: string | undefined },
    bypassCache: boolean,
  ): ResultAsync<unknown, DomainFailure> {
    return this.resolveSource(query.source).andThen((source) => {
      const normalizedId = id.trim();

      return fromPromise(
        this.medicinesCacheService.getOrSetSequences(
          source,
          normalizedId,
          bypassCache,
          () =>
            source === 'drugbank'
              ? this.drugbankMedicinesService.getSequences(normalizedId)
              : this.cnMedicinesService.getSequences(normalizedId),
        ),
        (error) =>
          createDomainFailure({
            kind: 'internal',
            code: 'INTERNAL_ERROR',
            cause: error instanceof Error ? error : undefined,
          }),
      ).andThen((sequences) => this.ensureFound(sequences));
    });
  }

  // Dead-code endpoint (no C-end consumer); see docs/TODO.md.
  async getRandomSafetyTips(
    excludeIds: string[],
    lang?: string,
  ): Promise<MedicineSafetyTipItem[]> {
    const normalizedLang = (lang ?? 'en').toLowerCase();
    const useChinese = normalizedLang.startsWith('zh');

    const allActiveTips = await this.safetyTipsSource.listActiveCached();

    if (allActiveTips.length === 0) {
      return [];
    }

    const excludedIdSet = new Set(excludeIds);
    const availableTips = allActiveTips.filter(
      (tip) => !excludedIdSet.has(tip.id),
    );

    const selected = availableTips.length > 0 ? availableTips : allActiveTips;

    return shuffleArray(selected)
      .slice(0, MedicinesService.SAFETY_TIPS_LIMIT)
      .map((tip) => ({
        id: tip.id,
        text: useChinese ? tip.contentZh : tip.contentEn,
        category: tip.category,
      }));
  }

  /**
   * Maps a nullable adapter result onto the standard `not_found` domain
   * failure, shared by the detail and sequences read paths.
   */
  private ensureFound<T>(value: T | null): ResultAsync<T, DomainFailure> {
    if (!value) {
      return errAsync(
        createDomainFailure({
          kind: 'not_found',
          code: 'RESOURCE_NOT_FOUND',
          detail: this.i18n.t('medicine.not_found'),
        }),
      );
    }
    return okAsync(value);
  }

  private resolveSource(
    source: string | undefined,
  ): ResultAsync<MedicineKnowledgeSource, DomainFailure> {
    if (source === undefined || source.trim() === '') {
      return okAsync(DEFAULT_MEDICINE_SOURCE);
    }

    if (source === 'drugbank' || source === 'cn') {
      return okAsync(source);
    }

    return errAsync(
      createDomainFailure({
        kind: 'validation',
        code: 'VALIDATION_FAILED',
        detail: this.i18n.t('medicine.source_invalid'),
      }),
    );
  }
}
