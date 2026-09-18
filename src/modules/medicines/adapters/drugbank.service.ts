import { Injectable } from '@nestjs/common';
import { Prisma } from '#generated/prisma/client.js';
import type {
  DrugbankDrug,
  DrugbankDrugTarget,
  DrugbankStructure,
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
import type {
  MedicineSequenceDataDto,
  SequenceSummaryDto,
} from '../dto/sequence.dto.js';
import type { MedicineStructureDto } from '../dto/structure.dto.js';
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

/**
 * `drugbank_drug_targets.relation_kind` doubles as provenance: the CSV import
 * writes its dataset name (`all`, `pharmacologically_active`), while the XML
 * import writes the real relationship type (`target`, `enzyme`, `carrier`,
 * `transporter`).
 */
const CSV_RELATION_KINDS = new Set(['all', 'pharmacologically_active']);

function isCsvRelation(relationKind: string | null): boolean {
  return relationKind !== null && CSV_RELATION_KINDS.has(relationKind);
}

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
        structure: true,
      },
    });

    if (!row) {
      return null;
    }

    const sequenceSummary = await this.countSequences(
      row.drugbankId,
      row.targetRelations,
    );

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
      sequenceSummary,
      structure: this.toStructure(row.structure),
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
   * Loads every sequence reachable from one drug: the drug's own chains plus
   * the protein and coding-gene sequences of its targets.
   *
   * Deliberately a separate call from `getDetail` — a well-studied drug carries
   * tens of thousands of characters here (Imatinib's 28 targets average ~1130 aa
   * of protein each), which has no business riding along with every page load.
   */
  async getSequences(id: string): Promise<MedicineSequenceDataDto | null> {
    const row = await this.prisma.drugbankDrug.findUnique({
      where: { drugbankId: id },
      select: {
        drugbankId: true,
        targetRelations: {
          select: { target: { select: { uniprotId: true } } },
        },
      },
    });

    if (!row) {
      return null;
    }

    const uniprotIds = uniqueNonEmptyStrings(
      row.targetRelations.map((relation) => relation.target.uniprotId ?? ''),
      Number.MAX_SAFE_INTEGER,
    );

    const [drugRows, targetRows] = await Promise.all([
      this.prisma.drugbankDrugSequence.findMany({
        where: { drugbankId: id },
        orderBy: { description: 'asc' },
      }),
      uniprotIds.length === 0
        ? Promise.resolve([])
        : this.prisma.drugbankTargetSequence.findMany({
            where: { uniprotId: { in: uniprotIds } },
            orderBy: [{ uniprotId: 'asc' }, { sourceDataset: 'asc' }],
          }),
    ]);

    return {
      id: row.drugbankId,
      source: 'drugbank',
      drug: drugRows.map((sequence) => ({
        description: sequence.description,
        length: sequence.length,
        sequence: sequence.sequence,
      })),
      targets: targetRows.map((sequence) => ({
        uniprotId: sequence.uniprotId,
        targetName: sequence.targetName,
        dataset: sequence.sourceDataset,
        length: sequence.length,
        sequence: sequence.sequence,
      })),
    };
  }

  /**
   * Maps the computed-structure row onto the wire block.
   *
   * Returns null when the drug has no structure row at all, so the client can
   * tell "no descriptors" apart from "descriptors that happen to be blank".
   */
  private toStructure(
    structure: DrugbankStructure | null,
  ): MedicineStructureDto | null {
    if (!structure) {
      return null;
    }

    return {
      smiles: structure.smiles,
      inchiKey: structure.inchiKey,
      inchiIdentifier: structure.inchiIdentifier,
      formula: structure.formula,
      iupacName: structure.jchemIupac,
      molecularWeight: structure.molecularWeight,
      exactMass: structure.exactMass,
      logP: structure.jchemLogp,
      polarSurfaceArea: structure.jchemPolarSurfaceArea,
      polarizability: structure.jchemAveragePolarizability,
      refractivity: structure.jchemRefractivity,
      alogpsLogP: structure.alogpsLogp,
      alogpsLogS: structure.alogpsLogs,
      alogpsSolubility: structure.alogpsSolubility,
      pka: structure.jchemPka,
      pkaStrongestAcidic: structure.jchemPkaStrongestAcidic,
      pkaStrongestBasic: structure.jchemPkaStrongestBasic,
      formalCharge: structure.jchemFormalCharge,
      physiologicalCharge: structure.jchemPhysiologicalCharge,
      neutralCharge: structure.jchemNeutralCharge,
      averageNeutralMicrospeciesCharge:
        structure.jchemAverageNeutralMicrospeciesCharge,
      atomCount: structure.jchemAtomCount,
      ringCount: structure.jchemNumberOfRings,
      rotatableBondCount: structure.jchemRotatableBondCount,
      acceptorCount: structure.jchemAcceptorCount,
      donorCount: structure.jchemDonorCount,
      ruleOfFive: structure.jchemRuleOfFive,
      veberRule: structure.jchemVeberRule,
      ghoseFilter: structure.jchemGhoseFilter,
      mddrLikeRule: structure.jchemMddrLikeRule,
      bioavailability: structure.jchemBioavailability,
      salts: toStringListOrNull(structure.salts),
    };
  }

  /**
   * Counts available sequences without loading any sequence text.
   *
   * The target count needs the ids first, so it costs one extra query; that is
   * still far cheaper than pulling the sequences just to label a section.
   */
  private async countSequences(
    drugbankId: string,
    targetRelations: DrugbankDrugTargetWithTarget[],
  ): Promise<SequenceSummaryDto | null> {
    const uniprotIds = uniqueNonEmptyStrings(
      targetRelations.map((relation) => relation.target.uniprotId ?? ''),
      Number.MAX_SAFE_INTEGER,
    );

    const [drugChainCount, targetSequenceCount] = await Promise.all([
      this.prisma.drugbankDrugSequence.count({ where: { drugbankId } }),
      uniprotIds.length === 0
        ? Promise.resolve(0)
        : this.prisma.drugbankTargetSequence.count({
            where: { uniprotId: { in: uniprotIds } },
          }),
    ]);

    if (drugChainCount === 0 && targetSequenceCount === 0) {
      return null;
    }

    return { drugChainCount, targetSequenceCount };
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
        { searchText: { contains: q, mode: 'insensitive' } },
        {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { casNumber: { contains: q, mode: 'insensitive' } },
            { unii: { contains: q, mode: 'insensitive' } },
          ],
        },
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
      // `searchText` is an internal index field (its content is a
      // concatenation of name/CAS/UNII/ids/groups/synonyms), so feeding it to
      // `detectMatchedBy` would report a duplicate match for every business
      // field hit — exclude it and let only the real business keys win.
      matchedBy: detectMatchedBy(query, [
        { key: 'name', value: row.name },
        { key: 'casNumber', value: row.casNumber },
        { key: 'unii', value: row.unii },
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
   * The same target can legitimately appear once per `relation_kind` (target,
   * enzyme, carrier, transporter) — those are kept as separate entries because
   * each edge carries its own `actions`.
   *
   * Rows tagged `all` come from the CSV export, which has no `Actions` column
   * and no relationship typing. Where the XML has already described the same
   * drug→target pair, the CSV row is a strictly poorer duplicate and is
   * dropped; CSV rows describing pairs the XML does not mention are kept.
   */
  private toTargets(
    relations: DrugbankDrugTargetWithTarget[],
  ): DrugbankTargetDto[] | null {
    if (relations.length === 0) {
      return null;
    }

    const xmlCoveredTargetIds = new Set(
      relations
        .filter((relation) => !isCsvRelation(relation.relationKind))
        .map((relation) => relation.targetId),
    );

    const targets = relations
      .filter(
        (relation) =>
          !isCsvRelation(relation.relationKind) ||
          !xmlCoveredTargetIds.has(relation.targetId),
      )
      .map((relation) => ({
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
