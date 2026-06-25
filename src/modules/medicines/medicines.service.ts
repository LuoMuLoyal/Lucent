import { notFound, badRequest } from '../../common/utils/api-errors';
import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import type {
  MedicineDetailDataDto,
  MedicineDetailQueryDto,
  MedicineKnowledgeSource,
  MedicineSearchQueryDto,
  MedicineSearchResult,
} from './dto';
import { DEFAULT_MEDICINE_SOURCE } from './dto';
import { MedicinesCacheService } from './cache/medicines-cache.service';
import { CnMedicinesService } from './sources/cn-medicines.service';
import { DrugbankMedicinesService } from './sources/drugbank-medicines.service';

@Injectable()
export class MedicinesService {
  constructor(
    private readonly drugbankMedicinesService: DrugbankMedicinesService,
    private readonly cnMedicinesService: CnMedicinesService,
    private readonly medicinesCacheService: MedicinesCacheService,
    private readonly i18n: I18nService,
  ) {}

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
