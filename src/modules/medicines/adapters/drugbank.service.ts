import { Injectable } from '@nestjs/common';
import { Prisma } from '#generated/prisma/client.js';
import type {
  DrugbankDrug,
  DrugbankDrugTarget,
  DrugbankTarget,
} from '#generated/prisma/client.js';
import { PrismaService } from '../../../prisma/index.js';
import type {
  DrugbankMedicineDetailDto,
  DrugbankTargetDto,
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
  toDrugbankDrugInteractions,
  toDrugbankExternalIdentifiers,
  toDrugbankExternalLinks,
  toPagination,
  toStringList,
  toStringListOrNull,
  truncateText,
  uniqueNonEmptyStrings,
} from '../utils/data-format.js';

/** A drug→target edge with its target row eagerly loaded. */
type DrugbankDrugTargetWithTarget = DrugbankDrugTarget & {
  target: DrugbankTarget;
};

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
      include: {
        targetRelations: {
          include: { target: true },
          orderBy: { createdAt: 'asc' },
        },
      },
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
      drugInteractions: toDrugbankDrugInteractions(row.drugInteractions),
      targets: this.toTargets(row.targetRelations),
      externalIdentifiers: toDrugbankExternalIdentifiers(
        row.externalIdentifiers,
      ),
      externalLinks: toDrugbankExternalLinks(row.externalLinks),
    };

    return {
      id: row.drugbankId,
      source: 'drugbank',
      name: row.name,
      subtitle: this.toSubtitle(row),
      detail,
    };
  }

  /**
   * Builds the search WHERE clause for DrugBank drugs.
   *
   * `searchText` is a pre-built text field (see import script
   * `drugbank_drugs.py`) that includes the drug name, CAS number, UNII,
   * secondary IDs, groups, and the first 20 synonyms. This provides broad
   * discovery but may cause over-matching on common synonym substrings.
   *
   * The `matchedBy` field in search results helps callers distinguish
   * whether a match came from `name`, `casNumber`, `unii`, `searchText`,
   * or `synonyms`.
   */
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

    const synonymList = toStringList(row.synonyms);
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
        ...synonymList.map((synonym) => ({
          key: 'synonyms',
          value: synonym,
        })),
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

  /**
   * Flattens the `drugbank_drug_targets` join rows into a single target list.
   *
   * The same target can appear once per `relation_kind` (target, enzyme,
   * carrier, transporter); each edge keeps its own `actions`/`knownAction`
   * so no relationship detail is lost.
   */
  private toTargets(
    relations: DrugbankDrugTargetWithTarget[],
  ): DrugbankTargetDto[] | null {
    if (relations.length === 0) {
      return null;
    }

    const targets = relations.map((relation) => ({
      name: relation.target.name,
      geneName: relation.target.geneName,
      uniprotId: relation.target.uniprotId,
      uniprotTitle: relation.target.uniprotTitle,
      species: relation.target.species,
      pdbIds: toStringListOrNull(relation.target.pdbIds),
      actions: toStringListOrNull(relation.actions),
      knownAction: relation.knownAction,
      relationKind: relation.relationKind,
    }));

    return targets.length > 0 ? targets : null;
  }
}
