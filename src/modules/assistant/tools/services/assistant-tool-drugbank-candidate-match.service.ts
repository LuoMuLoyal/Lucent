import { Injectable } from '@nestjs/common';
import type {
  AssistantReadResultEnvelope,
  AssistantToolExecutionContext,
} from '../../types/assistant.types';
import type {
  MedicineDetailDataDto,
  MedicineSearchItemDto,
} from '../../../medicines/dto';
import { CnMedicinesService } from '../../../medicines/sources/cn-medicines.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import {
  buildReadConfidence,
  buildReadEnvelope,
} from '../assistant-tool-presenters';
import { parseSearchPayload } from './assistant-tool-drugbank-entity-resolve.service';

const PRODUCT_RESOLVE_LIMIT = 5;
const DRUGBANK_CANDIDATE_LIMIT = 12;

const CN_ALIAS_TO_CANONICAL: Record<string, string> = {
  布洛芬: 'ibuprofen',
  对乙酰氨基酚: 'acetaminophen',
  扑热息痛: 'acetaminophen',
  咖啡因: 'caffeine',
  阿司匹林: 'aspirin',
  盐酸西替利嗪: 'cetirizine',
};

const CANONICAL_ENGLISH_ALIASES: Record<string, string[]> = {
  ibuprofen: ['ibuprofen'],
  acetaminophen: ['acetaminophen', 'paracetamol'],
  caffeine: ['caffeine'],
  aspirin: ['aspirin', 'acetylsalicylic acid'],
  cetirizine: ['cetirizine'],
};

const PRODUCT_NAME_NOISE_PATTERNS = [
  /\b\d+(\.\d+)?\s*(mg|g|ml)\b/gi,
  /\*/g,
  /缓释|控释|肠溶|分散|咀嚼|泡腾|滴丸|胶囊|片|颗粒|口服液|干混悬剂|混悬液|糖浆/g,
];

@Injectable()
export class AssistantToolDrugbankCandidateMatchService {
  constructor(
    private readonly cnMedicinesService: CnMedicinesService,
    private readonly prisma: PrismaService,
  ) {}

  async matchCandidates(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    const payload = parseMatchPayload(context.userMessage);
    const query = payload.query.trim();
    const resolved = await this.resolveProduct(payload.productId, query);

    if (resolved.kind === 'empty') {
      return buildReadEnvelope({
        toolName: 'match_cn_product_to_drugbank_candidates',
        query: {
          query,
          productId: payload.productId,
          matchedSource: 'cn',
        },
        result: {
          product: null,
          productCandidates: [],
          normalizedIngredients: [],
          unresolvedTokens: [],
          candidates: [],
        },
        coverage: {
          status: 'empty',
          reason: resolved.reason,
        },
        timeRange: { timezone: 'UTC', startDate: null, endDate: null },
        confidence: { level: 'low', reason: resolved.reason },
        ambiguities: [],
        tables: ['cn_medicine_products', 'drugbank_drugs'],
      });
    }

    if (resolved.kind === 'ambiguous') {
      return buildReadEnvelope({
        toolName: 'match_cn_product_to_drugbank_candidates',
        query: {
          query,
          productId: payload.productId,
          matchedSource: 'cn',
          candidateCount: resolved.candidates.length,
        },
        result: {
          product: null,
          productCandidates: toProductCandidates(resolved.candidates),
          normalizedIngredients: [],
          unresolvedTokens: [],
          candidates: [],
        },
        coverage: {
          status: 'partial',
          reason: resolved.reason,
        },
        timeRange: { timezone: 'UTC', startDate: null, endDate: null },
        confidence: {
          level: 'low',
          reason:
            'Multiple Chinese medicine products matched the query, so candidate bridging stopped before DrugBank lookup.',
        },
        ambiguities: resolved.candidates.map((item) => item.name),
        tables: ['cn_medicine_products', 'drugbank_drugs'],
      });
    }

    const product = resolved.product;
    const ingredientText = readCnIngredientText(product);
    const normalizedIngredients = normalizeIngredientText(ingredientText);
    const productTokens = normalizeProductNameTokens(product.name);
    const searchTokens =
      normalizedIngredients.length > 0 ? normalizedIngredients : productTokens;

    if (searchTokens.length === 0) {
      return buildReadEnvelope({
        toolName: 'match_cn_product_to_drugbank_candidates',
        query: {
          query,
          productId: product.id,
          matchedSource: 'cn',
        },
        result: {
          product,
          productCandidates: [],
          normalizedIngredients,
          unresolvedTokens: [],
          candidates: [],
        },
        coverage: {
          status: 'empty',
          reason:
            'No recognizable CN ingredient or product-name tokens were found.',
        },
        timeRange: { timezone: 'UTC', startDate: null, endDate: null },
        confidence: {
          level: 'low',
          reason:
            'No recognizable CN ingredient or product-name tokens were found.',
        },
        ambiguities: [],
        tables: ['cn_medicine_products', 'drugbank_drugs'],
      });
    }

    const rows = await this.prisma.drugbankDrug.findMany({
      where: {
        OR: searchTokens.flatMap((token) => [
          { name: { contains: token, mode: 'insensitive' as const } },
          { searchText: { contains: token, mode: 'insensitive' as const } },
        ]),
      },
      orderBy: [{ name: 'asc' }],
      take: DRUGBANK_CANDIDATE_LIMIT,
      select: {
        drugbankId: true,
        name: true,
        synonyms: true,
        searchText: true,
      },
    });

    const matchMode =
      normalizedIngredients.length > 0 ? 'ingredient' : 'product_name';
    const candidates = rows
      .map((row) => scoreDrugbankCandidate(row, searchTokens, matchMode))
      .filter((candidate) => candidate.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score || left.name.localeCompare(right.name),
      );

    const matchedTokens = new Set(
      candidates.flatMap((candidate) => candidate.matchedIngredients),
    );
    const unresolvedTokens = searchTokens.filter(
      (token) => !matchedTokens.has(token),
    );

    return buildReadEnvelope({
      toolName: 'match_cn_product_to_drugbank_candidates',
      query: {
        query,
        productId: product.id,
        matchedSource: 'cn',
        matchMode,
      },
      result: {
        product,
        productCandidates: [],
        normalizedIngredients,
        unresolvedTokens,
        candidates: candidates.map(
          ({ score: _score, ...candidate }) => candidate,
        ),
      },
      coverage: {
        status: 'complete',
        reason: null,
      },
      timeRange: { timezone: 'UTC', startDate: null, endDate: null },
      confidence: buildReadConfidence({
        ambiguities: unresolvedTokens,
        preferredReason:
          normalizedIngredients.length > 0
            ? 'Generated deterministic DrugBank candidates from normalized CN ingredient tokens.'
            : 'Generated fallback DrugBank candidates from normalized CN product-name tokens.',
      }),
      ambiguities: unresolvedTokens,
      tables: ['cn_medicine_products', 'drugbank_drugs'],
    });
  }

  private async resolveProduct(
    productId: string | null,
    query: string,
  ): Promise<
    | { kind: 'resolved'; product: MedicineDetailDataDto }
    | { kind: 'ambiguous'; candidates: MedicineSearchItemDto[]; reason: string }
    | { kind: 'empty'; reason: string }
  > {
    if (productId) {
      const detail = await this.cnMedicinesService.getDetail(productId);
      if (!detail) {
        return {
          kind: 'empty',
          reason: `No Chinese medicine detail was found for "${productId}".`,
        };
      }
      return { kind: 'resolved', product: detail };
    }

    if (!query) {
      return {
        kind: 'empty',
        reason: 'No product query was provided.',
      };
    }

    const search = await this.cnMedicinesService.search({
      q: query,
      page: 1,
      pageSize: PRODUCT_RESOLVE_LIMIT,
    });

    if (search.items.length === 0) {
      return {
        kind: 'empty',
        reason: `No Chinese medicine product matched "${query}".`,
      };
    }

    if (search.items.length > 1) {
      return {
        kind: 'ambiguous',
        candidates: search.items,
        reason: `Multiple Chinese medicine products matched "${query}".`,
      };
    }

    const item = search.items[0];
    if (!item) {
      return {
        kind: 'empty',
        reason: 'No product resolved.',
      };
    }

    const detail = await this.cnMedicinesService.getDetail(item.id);
    if (!detail) {
      return {
        kind: 'empty',
        reason: `No Chinese medicine detail was found for "${item.id}".`,
      };
    }

    return { kind: 'resolved', product: detail };
  }
}

function parseMatchPayload(raw: string): {
  query: string;
  productId: string | null;
} {
  const base = parseSearchPayload(raw);
  const trimmed = raw.trim();

  if (!trimmed.startsWith('{')) {
    return {
      query: base.query,
      productId: readString(base.filters['productId']),
    };
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const id = readString(parsed['id']);
    return {
      query: base.query,
      productId:
        readString(parsed['productId']) ??
        readString(base.filters['productId']) ??
        id,
    };
  } catch {
    return {
      query: base.query,
      productId: readString(base.filters['productId']),
    };
  }
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function readCnIngredientText(product: MedicineDetailDataDto): string | null {
  const detail = product.detail;
  if (!('ingredients' in detail)) {
    return null;
  }

  const ingredients = detail.ingredients;
  return typeof ingredients === 'string' && ingredients.trim().length > 0
    ? ingredients.trim()
    : null;
}

function normalizeIngredientText(text: string | null): string[] {
  if (!text) {
    return [];
  }

  const unique = new Set<string>();
  for (const [cnAlias, canonical] of Object.entries(CN_ALIAS_TO_CANONICAL)) {
    if (text.includes(cnAlias)) {
      unique.add(canonical);
    }
  }

  return [...unique];
}

function normalizeProductNameTokens(name: string): string[] {
  let cleaned = name;
  for (const pattern of PRODUCT_NAME_NOISE_PATTERNS) {
    cleaned = cleaned.replace(pattern, ' ');
  }

  const unique = new Set<string>();
  for (const [cnAlias, canonical] of Object.entries(CN_ALIAS_TO_CANONICAL)) {
    if (cleaned.includes(cnAlias)) {
      unique.add(canonical);
    }
  }

  return [...unique];
}

function toProductCandidates(items: MedicineSearchItemDto[]) {
  return items.map((item) => ({
    id: item.id,
    source: item.source,
    name: item.name,
    subtitle: item.subtitle,
    matchedBy: item.matchedBy,
  }));
}

function scoreDrugbankCandidate(
  row: {
    drugbankId: string;
    name: string;
    synonyms: unknown;
    searchText: string | null;
  },
  searchTokens: string[],
  matchMode: 'ingredient' | 'product_name',
) {
  const normalizedName = normalizeEnglishText(row.name);
  const synonyms = normalizeUnknownStringList(row.synonyms);
  const normalizedSynonyms = synonyms.map((item) => normalizeEnglishText(item));
  const normalizedSearchText = normalizeEnglishText(row.searchText ?? '');
  const matchedIngredients: string[] = [];

  for (const token of searchTokens) {
    const englishAliases = CANONICAL_ENGLISH_ALIASES[token] ?? [token];
    const matched = englishAliases.some((alias) => {
      const normalizedAlias = normalizeEnglishText(alias);
      return (
        normalizedName === normalizedAlias ||
        normalizedSynonyms.includes(normalizedAlias) ||
        normalizedSearchText.includes(normalizedAlias)
      );
    });

    if (matched) {
      matchedIngredients.push(token);
    }
  }

  const matchedSet = [...new Set(matchedIngredients)];
  if (matchedSet.length === 0) {
    return {
      drugbankId: row.drugbankId,
      name: row.name,
      score: 0,
      confidence: 'low' as const,
      matchType:
        matchMode === 'ingredient' ? 'ingredient_exact' : 'product_name_alias',
      matchedIngredients: [],
      evidence: [],
    };
  }

  const isIngredientMode = matchMode === 'ingredient';
  return {
    drugbankId: row.drugbankId,
    name: row.name,
    score: isIngredientMode ? 100 + matchedSet.length : 60 + matchedSet.length,
    confidence: isIngredientMode ? ('high' as const) : ('medium' as const),
    matchType: isIngredientMode
      ? ('ingredient_exact' as const)
      : ('product_name_alias' as const),
    matchedIngredients: matchedSet,
    evidence: matchedSet.map((token) => ({
      token,
      matchedDrugbankId: row.drugbankId,
      matchedName: row.name,
    })),
  };
}

function normalizeUnknownStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

function normalizeEnglishText(value: string): string {
  return value.trim().toLowerCase();
}
