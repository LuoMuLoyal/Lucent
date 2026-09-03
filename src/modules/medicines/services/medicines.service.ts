import { Injectable, Logger } from '@nestjs/common';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { I18nService } from 'nestjs-i18n';

import { shuffleArray, safeParseLlmJson } from '../../../common/index.js';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../common/result/index.js';
import { PrismaService } from '../../../prisma/index.js';
import {
  DEFAULT_MEDICINE_SOURCE,
  type MedicineKnowledgeSource,
} from '../dto/source.dto.js';

import { MedicineSafetyTipResponseDto } from '../dto/safety-tip-response.dto.js';

import type { MedicineDetailDataDto } from '../dto/detail.dto.js';

import type {
  MedicineDetailQueryDto,
  MedicineSearchQueryDto,
} from '../dto/query.dto.js';

import type { MedicineSearchResult } from '../dto/search.dto.js';
import { MedicinesCacheService } from '../cache/store.service.js';
import { CnMedicinesService } from '../adapters/cn.service.js';
import { DrugbankMedicinesService } from '../adapters/drugbank.service.js';
import { LlmRuntimeService } from '../../../llm-runtime/index.js';

@Injectable()
export class MedicinesService {
  private static readonly SAFETY_TIPS_LIMIT = 4;

  private readonly logger = new Logger(MedicinesService.name);

  constructor(
    private readonly drugbankMedicinesService: DrugbankMedicinesService,
    private readonly cnMedicinesService: CnMedicinesService,
    private readonly medicinesCacheService: MedicinesCacheService,
    private readonly i18n: I18nService,
    private readonly prisma: PrismaService,
    private readonly llmRuntime: LlmRuntimeService,
  ) {}

  async recognizeMedicine(imageUrl: string): Promise<{
    name: string | null;
    approvalNumber: string | null;
    specification: string | null;
    manufacturer: string | null;
  }> {
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
    }) as {
      name: string | null;
      approvalNumber: string | null;
      specification: string | null;
      manufacturer: string | null;
    } | null;

    return (
      parsed ?? {
        name: null,
        approvalNumber: null,
        specification: null,
        manufacturer: null,
      }
    );
  }

  search(
    query: MedicineSearchQueryDto,
  ): ResultAsync<MedicineSearchResult, DomainFailure> {
    return this.searchWithCache(query, false);
  }

  searchWithCache(
    query: MedicineSearchQueryDto,
    bypassCache: boolean,
  ): ResultAsync<MedicineSearchResult, DomainFailure> {
    return this.resolveSource(query.source).andThen((source) => {
      const criteria = {
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
    query: MedicineDetailQueryDto,
  ): ResultAsync<MedicineDetailDataDto, DomainFailure> {
    return this.getDetailWithCache(id, query, false);
  }

  getDetailWithCache(
    id: string,
    query: MedicineDetailQueryDto,
    bypassCache: boolean,
  ): ResultAsync<MedicineDetailDataDto, DomainFailure> {
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
      ).andThen((detail) => {
        if (!detail) {
          return errAsync(
            createDomainFailure({
              kind: 'not_found',
              code: 'RESOURCE_NOT_FOUND',
              detail: this.i18n.t('medicine.not_found'),
            }),
          );
        }
        return okAsync(detail);
      });
    });
  }

  // TODO(archive): 接口完整但当前无任何 C 端 UI 消费方（死代码保留）；
  // 若未来做随机安全贴士，应在移动端药品详情页内以审核内容卡片形式重做。
  async getRandomSafetyTips(
    excludeIds: string[],
    lang?: string,
  ): Promise<MedicineSafetyTipResponseDto[]> {
    const normalizedLang = (lang ?? 'en').toLowerCase();
    const useChinese = normalizedLang.startsWith('zh');

    const allActiveTips = await this.medicinesCacheService.getOrSetSafetyTips(
      () =>
        this.prisma.medicineSafetyTip.findMany({
          where: { isActive: true },
        }),
    );

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
