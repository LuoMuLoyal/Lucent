import { Injectable } from '@nestjs/common';
import { Prisma } from '#generated/prisma/client';
import type { DrugbankDrug } from '#generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  DrugbankMedicineDetailDto,
  MedicineDetailDataDto,
  MedicineSearchItemDto,
  MedicineSearchResult,
} from '../dto';
import {
  composeSubtitle,
  detectMatchedBy,
  firstNonEmpty,
  toPagination,
  toStringList,
  truncateText,
  uniqueNonEmptyStrings,
} from '../services/medicines.utils';

interface MedicineSearchCriteria {
  q: string;
  page: number;
  pageSize: number;
}

@Injectable()
export class DrugbankMedicinesService {
  constructor(private readonly prisma: PrismaService) {}

  async search(
    criteria: MedicineSearchCriteria,
  ): Promise<MedicineSearchResult> {
    const where = this.buildWhere(criteria.q);
    const skip = (criteria.page - 1) * criteria.pageSize;

    const [rows, total] = await Promise.all([
      this.prisma.drugbankDrug.findMany({
        where,
        orderBy: [{ name: 'asc' }],
        skip,
        take: criteria.pageSize,
      }),
      this.prisma.drugbankDrug.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toSearchItem(row, criteria.q)),
      pagination: toPagination(criteria.page, criteria.pageSize, total),
    };
  }

  async getDetail(id: string): Promise<MedicineDetailDataDto | null> {
    const row = await this.prisma.drugbankDrug.findUnique({
      where: { drugbankId: id },
    });

    if (!row) {
      return null;
    }

    const detail: DrugbankMedicineDetailDto = {
      kind: 'drugbank',
      drugType: row.drugType,
      state: row.state,
      description: row.description,
      indication: row.indication,
      mechanismOfAction: row.mechanismOfAction,
      pharmacodynamics: row.pharmacodynamics,
      toxicity: row.toxicity,
      metabolism: row.metabolism,
      absorption: row.absorption,
      halfLife: row.halfLife,
      proteinBinding: row.proteinBinding,
      routeOfElimination: row.routeOfElimination,
      volumeOfDistribution: row.volumeOfDistribution,
      clearance: row.clearance,
      groups: toStringList(row.groups),
      categories: toStringList(row.categories),
      atcCodes: toStringList(row.atcCodes),
      synonyms: toStringList(row.synonyms),
      foodInteractions: toStringList(row.foodInteractions),
      drugInteractions: row.drugInteractions,
      externalIdentifiers: row.externalIdentifiers,
      externalLinks: row.externalLinks,
    };

    return {
      id: row.drugbankId,
      source: 'drugbank',
      name: row.name,
      subtitle: this.toSubtitle(row),
      detail,
    };
  }

  private buildWhere(q: string): Prisma.DrugbankDrugWhereInput {
    if (!q) {
      return {};
    }

    return {
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { casNumber: { contains: q, mode: 'insensitive' } },
        { unii: { contains: q, mode: 'insensitive' } },
        { searchText: { contains: q, mode: 'insensitive' } },
      ],
    };
  }

  private toSearchItem(
    row: DrugbankDrug,
    query: string,
  ): MedicineSearchItemDto {
    const tags = uniqueNonEmptyStrings(
      [
        ...toStringList(row.groups),
        ...toStringList(row.categories),
        ...toStringList(row.atcCodes),
      ],
      4,
    );

    return {
      id: row.drugbankId,
      source: 'drugbank',
      name: row.name,
      subtitle: this.toSubtitle(row),
      summary: truncateText(firstNonEmpty(row.description, row.indication)),
      tags,
      imageUrl: null,
      matchedBy: detectMatchedBy(query, [
        { key: 'name', value: row.name },
        { key: 'casNumber', value: row.casNumber },
        { key: 'unii', value: row.unii },
        { key: 'searchText', value: row.searchText },
      ]),
    };
  }

  private toSubtitle(row: DrugbankDrug): string | null {
    return composeSubtitle(
      row.casNumber ? `CAS ${row.casNumber}` : null,
      ...toStringList(row.groups).slice(0, 2),
      row.drugType,
    );
  }
}
