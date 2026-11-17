import { Injectable } from '@nestjs/common';
import { Prisma } from '#generated/prisma/client.js';
import type { CnMedicineProduct } from '#generated/prisma/client.js';
import { PrismaService } from '../../../../prisma/index.js';
import {
  composeSubtitle,
  detectMatchedBy,
  firstNonEmpty,
  toPagination,
  truncateText,
  uniqueNonEmptyStrings,
} from '../../application/read_models/medicine-card.format.js';
import type {
  MedicinesSourceReader,
  MedicineSearchCriteria,
  MedicineSearchResultLike,
} from '../../application/ports/knowledge.js';
import type {
  CnMedicineDetail,
  MedicineDetailView,
  MedicineSequenceView,
} from '../../application/ports/knowledge-view.js';

@Injectable()
export class CnMedicinesService implements MedicinesSourceReader<MedicineDetailView> {
  constructor(private readonly prisma: PrismaService) {}

  async search(
    criteria: MedicineSearchCriteria,
  ): Promise<MedicineSearchResultLike> {
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

  /**
   * Sequences for one CN product.
   *
   * The CN source is a leaflet database with no sequence columns, so it always
   * answers with an empty set rather than a 404 — the medicine itself exists.
   * Routing through this adapter (instead of a `Promise.resolve` inline in the
   * facade) keeps the sequences read on the same cache + adapter dispatch path
   * as detail / search, so its cache key for CN is consistent even when the
   * source one day starts carrying sequences.
   */
  getSequences(id: string): Promise<MedicineSequenceView | null> {
    return Promise.resolve({
      id,
      source: 'cn',
      drug: [],
      targets: [],
    });
  }

  async getDetail(id: string): Promise<MedicineDetailView | null> {
    const row = await this.prisma.cnMedicineProduct.findUnique({
      where: { id },
      include: {
        leafletLinks: {
          include: { leaflet: true },
          take: 1,
        },
      },
    });

    if (!row) {
      return null;
    }

    // V3: the product table is a catalogue only — body text lives in the
    // leaflet reached via the 1:1 link.
    const leaflet = row.leafletLinks[0]?.leaflet ?? null;

    const detail: CnMedicineDetail = {
      kind: 'cnProduct',
      approvalNumber: row.approvalNumber,
      manufacturer: row.manufacturer,
      packageSpec: row.packageSpec,
      brandName: row.brandName,
      ingredients: leaflet?.ingredients ?? null,
      properties: leaflet?.appearance ?? null,
      indications: leaflet?.indications ?? null,
      dosage: leaflet?.dosage ?? null,
      adverseReactions: leaflet?.adverseReactions ?? null,
      contraindications: leaflet?.contraindications ?? null,
      precautions: leaflet?.precautions ?? null,
      pharmacologyToxicology: leaflet?.pharmacologyToxicology ?? null,
      pharmacokinetics: leaflet?.pharmacokinetics ?? null,
      overdose: row.overdose,
      storage: leaflet?.storage ?? null,
      validityPeriod: leaflet?.validityPeriod ?? null,
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
        { searchText: { contains: q, mode: 'insensitive' } },
        {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { brandName: { contains: q, mode: 'insensitive' } },
            { approvalNumber: { contains: q, mode: 'insensitive' } },
            { barcode: { contains: q, mode: 'insensitive' } },
            { nationalDrugCode: { contains: q, mode: 'insensitive' } },
          ],
        },
      ],
    };
  }

  private toSearchItem(row: CnMedicineProduct, query: string) {
    return {
      id: row.id,
      source: 'cn' as const,
      name: row.name,
      subtitle: this.toSubtitle(row),
      // V3: body text lives in the leaflet (reached via link), not on the
      // product row. The search card summary uses catalogue fields only.
      summary: truncateText(
        firstNonEmpty(row.mainCategory, row.subcategory, row.drugType),
      ),
      tags: uniqueNonEmptyStrings(
        [row.drugType, row.mainCategory, row.subcategory],
        4,
      ),
      imageUrl: row.imageUrl,
      // `searchText` is an internal index field (concatenation of
      // name/brandName/manufacturer/approval/barcode/...), so it is excluded
      // from `matchedBy` to avoid duplicate business-key hits.
      matchedBy: detectMatchedBy(query, [
        { key: 'name', value: row.name },
        { key: 'brandName', value: row.brandName },
        { key: 'approvalNumber', value: row.approvalNumber },
        { key: 'barcode', value: row.barcode },
        { key: 'nationalDrugCode', value: row.nationalDrugCode },
      ]),
    };
  }

  private toSubtitle(row: CnMedicineProduct): string | null {
    return composeSubtitle(row.packageSpec, row.manufacturer);
  }
}
