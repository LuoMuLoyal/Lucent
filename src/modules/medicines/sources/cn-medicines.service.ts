import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import type { CnMedicineProduct } from '../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  CnMedicineDetailDto,
  MedicineDetailDataDto,
  MedicineSearchItemDto,
  MedicineSearchResult,
} from '../dto';
import {
  composeSubtitle,
  detectMatchedBy,
  firstNonEmpty,
  toPagination,
  truncateText,
  uniqueNonEmptyStrings,
} from '../medicines.utils';

interface MedicineSearchCriteria {
  q: string;
  page: number;
  pageSize: number;
}

const PREGNANCY_KEYWORDS = [
  '孕',
  '妊娠',
  '怀孕',
  '孕期',
  '胎儿',
  '胚胎',
  '备孕',
  '产后',
  'pregnan',
  'gestat',
  'fetus',
  'foetus',
  'conception',
  'postpartum',
];

const LACTATION_KEYWORDS = [
  '哺乳',
  '哺乳期',
  '乳母',
  '乳汁',
  '授乳',
  '喂奶',
  '母乳',
  'lactat',
  'breastfeed',
  'breast-feeding',
  'breast feeding',
  'nursing',
  'milk',
];

const SENTENCE_DELIMITER_PATTERN = /([。；;?？!！\n\r])/;

function splitSentences(text: string): string[] {
  const parts = text.split(SENTENCE_DELIMITER_PATTERN);
  const sentences: string[] = [];
  let current = '';

  for (const part of parts) {
    if (SENTENCE_DELIMITER_PATTERN.test(part)) {
      current += part;
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        sentences.push(trimmed);
      }
      current = '';
    } else {
      current += part;
    }
  }

  const trimmed = current.trim();
  if (trimmed.length > 0) {
    sentences.push(trimmed);
  }

  return sentences;
}

function mentionsAny(text: string, keywords: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword));
}

function splitPregnancyLactation(text: string | null): {
  pregnancy: string | null;
  lactation: string | null;
} {
  if (!text || text.trim().length === 0) {
    return { pregnancy: null, lactation: null };
  }

  const pregnancyParts: string[] = [];
  const lactationParts: string[] = [];

  for (const sentence of splitSentences(text)) {
    const hasPregnancy = mentionsAny(sentence, PREGNANCY_KEYWORDS);
    const hasLactation = mentionsAny(sentence, LACTATION_KEYWORDS);

    if (hasPregnancy) {
      pregnancyParts.push(sentence);
    }
    if (hasLactation) {
      lactationParts.push(sentence);
    }
  }

  if (pregnancyParts.length === 0 && lactationParts.length === 0) {
    return { pregnancy: text.trim(), lactation: text.trim() };
  }

  return {
    pregnancy: pregnancyParts.length > 0 ? pregnancyParts.join('\n') : null,
    lactation: lactationParts.length > 0 ? lactationParts.join('\n') : null,
  };
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

    const { pregnancy, lactation } = splitPregnancyLactation(
      row.pregnancyLactation,
    );

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
      pediatricUse: row.pediatricUse,
      geriatricUse: row.geriatricUse,
      pregnancyLactation: row.pregnancyLactation,
      pregnancy,
      lactation,
      pharmacologyToxicology: row.pharmacologyToxicology,
      drugInteractions: row.drugInteractions,
      pharmacokinetics: row.pharmacokinetics,
      overdose: row.overdose,
      storage: row.storage,
      validityPeriod: row.validityPeriod,
      barcode: row.barcode,
      nationalDrugCode: row.nationalDrugCode,
      sourceUrl: row.sourceUrl,
      imageUrl: row.imageUrl,
      drugbankIds: this.parseDrugbankIds(row.drugbankIds),
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

  private parseDrugbankIds(value: unknown): string[] | null {
    if (!value) return null;
    if (Array.isArray(value)) {
      const ids = value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0);
      return ids.length > 0 ? ids : null;
    }
    return null;
  }
}
