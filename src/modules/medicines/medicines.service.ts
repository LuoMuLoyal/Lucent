import { notFound, badRequest } from '../../common/utils/api-errors';
import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DEFAULT_MEDICINE_SOURCE,
  MedicineSafetyTipResponseDto,
  type MedicineDetailDataDto,
  type MedicineDetailQueryDto,
  type MedicineKnowledgeSource,
  type MedicineSearchQueryDto,
  type MedicineSearchResult,
} from './dto';
import { MedicinesCacheService } from './cache/medicines-cache.service';
import { CnMedicinesService } from './sources/cn-medicines.service';
import { DrugbankMedicinesService } from './sources/drugbank-medicines.service';
import { LlmRuntimeService } from '../llm-runtime/llm-runtime.service';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

@Injectable()
export class MedicinesService {
  private static readonly SAFETY_TIPS_LIMIT = 4;

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

    const systemPrompt = `你是一个药品识别助手。从药品包装图片中提取信息，以 JSON 格式返回。
只返回 JSON，不要其他文字。JSON 格式：
{"name": "药品名称", "approvalNumber": "国药准字", "specification": "规格", "manufacturer": "厂商"}

如果某项无法识别，设为空字符串""。`;

    const response = await model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage({
        content: [
          { type: 'text', text: '识别这张药品包装图片' },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      }),
    ]);

    const text =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

    try {
      const jsonStart = text.indexOf('{');
      const jsonEnd = text.lastIndexOf('}') + 1;
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        return JSON.parse(text.slice(jsonStart, jsonEnd)) as {
          name: string | null;
          approvalNumber: string | null;
          specification: string | null;
          manufacturer: string | null;
        };
      }
    } catch {
      /* fall through */
    }

    return {
      name: null,
      approvalNumber: null,
      specification: null,
      manufacturer: null,
    };
  }

  async search(query: MedicineSearchQueryDto): Promise<MedicineSearchResult> {
    return this.searchWithCache(query, false);
  }

  async searchWithCache(
    query: MedicineSearchQueryDto,
    bypassCache: boolean,
  ): Promise<MedicineSearchResult> {
    const source = this.resolveSource(query.source);
    const criteria = {
      q: query.q?.trim() ?? '',
      page: query.page,
      pageSize: query.pageSize,
    };

    return this.medicinesCacheService.getOrSetSearch(
      {
        source,
        ...criteria,
      },
      bypassCache,
      () =>
        source === 'drugbank'
          ? this.drugbankMedicinesService.search(criteria)
          : this.cnMedicinesService.search(criteria),
    );
  }

  async getDetail(
    id: string,
    query: MedicineDetailQueryDto,
  ): Promise<MedicineDetailDataDto> {
    return this.getDetailWithCache(id, query, false);
  }

  async getDetailWithCache(
    id: string,
    query: MedicineDetailQueryDto,
    bypassCache: boolean,
  ): Promise<MedicineDetailDataDto> {
    const source = this.resolveSource(query.source);
    const normalizedId = id.trim();

    const detail = await this.medicinesCacheService.getOrSetDetail(
      source,
      normalizedId,
      bypassCache,
      () =>
        source === 'drugbank'
          ? this.drugbankMedicinesService.getDetail(normalizedId)
          : this.cnMedicinesService.getDetail(normalizedId),
    );

    if (!detail) {
      notFound(this.i18n.t('medicine.not_found'));
    }

    return detail;
  }

  async getRandomSafetyTips(
    excludeIds: string[],
    lang?: string,
  ): Promise<MedicineSafetyTipResponseDto[]> {
    const normalizedLang = (lang ?? 'en').toLowerCase();
    const useChinese = normalizedLang.startsWith('zh');

    const allActiveTips = await this.prisma.medicineSafetyTip.findMany({
      where: { isActive: true },
    });

    if (allActiveTips.length === 0) {
      return [];
    }

    const excludedIdSet = new Set(excludeIds);
    const availableTips = allActiveTips.filter(
      (tip) => !excludedIdSet.has(tip.id),
    );

    const selected = availableTips.length > 0 ? availableTips : allActiveTips;

    return this.shuffleArray(selected)
      .slice(0, MedicinesService.SAFETY_TIPS_LIMIT)
      .map((tip) => ({
        id: tip.id,
        text: useChinese ? tip.contentZh : tip.contentEn,
        category: tip.category,
      }));
  }

  private shuffleArray<T>(array: readonly T[]): T[] {
    return [...array].sort(() => Math.random() - 0.5);
  }

  private resolveSource(source: string | undefined): MedicineKnowledgeSource {
    if (source === undefined || source.trim() === '') {
      return DEFAULT_MEDICINE_SOURCE;
    }

    if (source === 'drugbank' || source === 'cn') {
      return source;
    }

    badRequest(this.i18n.t('medicine.source_invalid'));
  }
}
