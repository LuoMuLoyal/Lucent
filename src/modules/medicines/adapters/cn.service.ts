import { Injectable } from '@nestjs/common';
import { Prisma } from '#generated/prisma/client.js';
import type { CnMedicineProduct } from '#generated/prisma/client.js';
import { PrismaService } from '../../../prisma/index.js';
import type {
  CnMedicineDetailDto,
  MedicineDetailDataDto,
} from '../dto/detail.dto.js';

import type {
  MedicineSearchItemDto,
  MedicineSearchResult,
} from '../dto/search.dto.js';
import {
  composeSubtitle,
  detectMatchedBy,
  firstNonEmpty,
  toPagination,
  truncateText,
  uniqueNonEmptyStrings,
} from '../utils/data-format.js';

interface MedicineSearchCriteria {
  q: string;
  page: number;
  pageSize: number;
}

@Injectable()
export class CnMedicinesService {
  constructor(private readonly prisma: PrismaService) {}

  async search(
    criteria: MedicineSearchCriteria,
  ): Promise<MedicineSearchResult> {
    const where = this.buildWhere(criteria.q);
    const skip = (criteria.page - 1) * criteria.pageSize;

    const [rows, total] = await Promise.all([
      this.prisma.cnMedicineProduct.findMany({
        where,
        orderBy: [{ name: 'asc' }],
        skip,
        take: criteria.pageSize,
      }),
      this.prisma.cnMedicineProduct.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toSearchItem(row, criteria.q)),
      pagination: toPagination(criteria.page, criteria.pageSize, total),
    };
  }

  async getDetail(id: string): Promise<MedicineDetailDataDto | null> {
    const row = await this.prisma.cnMedicineProduct.findUnique({
      where: { id },
    });

    if (!row) {
      return null;
    }

    const detail: CnMedicineDetailDto = {
      kind: 'cnProduct',
      approvalNumber: row.approvalNumber,
      manufacturer: row.manufacturer,
      packageSpec: row.packageSpec,
      brandName: row.brandName,
      ingredients: row.ingredients,
      properties: row.properties,
      indications: row.indications,
      dosage: row.dosage,
      adverseReactions: row.adverseReactions,
      contraindications: row.contraindications,
      precautions: row.precautions,
      pharmacologyToxicology: row.pharmacologyToxicology,
      pharmacokinetics: row.pharmacokinetics,
      overdose: row.overdose,
      storage: row.storage,
      validityPeriod: row.validityPeriod,
      barcode: row.barcode,
      nationalDrugCode: row.nationalDrugCode,
      sourceUrl: row.sourceUrl,
      imageUrl: row.imageUrl,
    };

    return {
      id: row.id,
      source: 'cn',
      name: row.name,
      subtitle: this.toSubtitle(row),
      detail,
    };
  }

  private buildWhere(q: string): Prisma.CnMedicineProductWhereInput {
    if (!q) {
      return {};
    }

    return {
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { brandName: { contains: q, mode: 'insensitive' } },
        { approvalNumber: { contains: q, mode: 'insensitive' } },
        { barcode: { contains: q, mode: 'insensitive' } },
        { nationalDrugCode: { contains: q, mode: 'insensitive' } },
        { searchText: { contains: q, mode: 'insensitive' } },
      ],
    };
  }

  private toSearchItem(
    row: CnMedicineProduct,
    query: string,
  ): MedicineSearchItemDto {
    return {
      id: row.id,
      source: 'cn',
      name: row.name,
      subtitle: this.toSubtitle(row),
      summary: truncateText(firstNonEmpty(row.indications, row.properties)),
      tags: uniqueNonEmptyStrings(
        [row.drugType, row.mainCategory, row.subcategory],
        4,
      ),
      imageUrl: row.imageUrl,
      matchedBy: detectMatchedBy(query, [
        { key: 'name', value: row.name },
        { key: 'brandName', value: row.brandName },
        { key: 'approvalNumber', value: row.approvalNumber },
        { key: 'barcode', value: row.barcode },
        { key: 'nationalDrugCode', value: row.nationalDrugCode },
        { key: 'searchText', value: row.searchText },
      ]),
    };
  }

  private toSubtitle(row: CnMedicineProduct): string | null {
    return composeSubtitle(row.packageSpec, row.manufacturer);
  }
}
