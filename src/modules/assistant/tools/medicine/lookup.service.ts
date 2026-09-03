import { Injectable, Logger } from '@nestjs/common';
import type { AssistantReadResultEnvelope } from '../../types/assistant.types.js';
import type { AssistantToolExecutionContext } from '../../types/assistant.types.js';
import type { MedicineSearchItemDto } from '../../../medicines/index.js';
import { CnMedicinesService } from '../../../medicines/index.js';
import { DrugbankMedicinesService } from '../../../medicines/index.js';
import { buildReadConfidence, buildReadEnvelope } from '../presenters.js';
import { parseSearchPayload } from '../drugbank/entity-resolve.service.js';

const DEFAULT_SEARCH_LIMIT = 4;
const MAX_SEARCH_LIMIT = 8;
const DETAIL_RESOLVE_LIMIT = 5;

@Injectable()
export class AssistantToolMedicineLookupService {
  private readonly logger = new Logger(AssistantToolMedicineLookupService.name);

  constructor(
    private readonly cnMedicinesService: CnMedicinesService,
    private readonly drugbankMedicinesService: DrugbankMedicinesService,
  ) {}

  async searchCnMedicineProducts(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    const payload = parseLookupPayload(context.userMessage, this.logger);
    const query = payload.query.trim();
    const limit = normalizeLimit(payload.limit);

    if (!query) {
      return buildReadEnvelope({
        toolName: 'search_cn_medicine_products',
        query: { query, matchedSource: 'cn' },
        result: { products: [], pagination: null },
        coverage: { status: 'empty', reason: 'No query was provided.' },
        timeRange: { timezone: 'UTC', startDate: null, endDate: null },
        confidence: { level: 'low', reason: 'Empty query.' },
        ambiguities: [],
        tables: ['cn_medicine_products'],
      });
    }

    const search = await this.cnMedicinesService.search({
      q: query,
      page: 1,
      pageSize: limit,
    });
    const ambiguities = extractCandidateNames(search.items);

    if (search.items.length === 0) {
      return buildReadEnvelope({
        toolName: 'search_cn_medicine_products',
        query: { query, matchedSource: 'cn', limit },
        result: {
          products: [],
          pagination: search.pagination,
        },
        coverage: {
          status: 'empty',
          reason: `No Chinese medicine product matched "${query}".`,
        },
        timeRange: { timezone: 'UTC', startDate: null, endDate: null },
        confidence: {
          level: 'low',
          reason: 'No matching Chinese medicine product.',
        },
        ambiguities: [],
        tables: ['cn_medicine_products'],
      });
    }

    return buildReadEnvelope({
      toolName: 'search_cn_medicine_products',
      query: {
        query,
        matchedSource: 'cn',
        limit,
      },
      result: {
        products: search.items,
        pagination: search.pagination,
      },
      coverage: { status: 'complete', reason: null },
      timeRange: { timezone: 'UTC', startDate: null, endDate: null },
      confidence: buildReadConfidence({
        ambiguities,
        preferredReason:
          'Returned structured Chinese medicine product candidates from Lucent tables.',
      }),
      ambiguities,
      tables: ['cn_medicine_products'],
    });
  }

  async getCnMedicineDetail(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    const payload = parseLookupPayload(context.userMessage, this.logger);
    const directId = payload.productId;
    const query = payload.query.trim();

    if (directId) {
      return this.buildCnDetailById(directId, query);
    }

    if (!query) {
      return buildReadEnvelope({
        toolName: 'get_cn_medicine_detail',
        query: { query, matchedSource: 'cn' },
        result: { product: null, candidates: [] },
        coverage: {
          status: 'empty',
          reason: 'No product query was provided.',
        },
        timeRange: { timezone: 'UTC', startDate: null, endDate: null },
        confidence: { level: 'low', reason: 'Empty query.' },
        ambiguities: [],
        tables: ['cn_medicine_products'],
      });
    }

    const search = await this.cnMedicinesService.search({
      q: query,
      page: 1,
      pageSize: DETAIL_RESOLVE_LIMIT,
    });

    if (search.items.length === 0) {
      return buildReadEnvelope({
        toolName: 'get_cn_medicine_detail',
        query: { query, matchedSource: 'cn' },
        result: { product: null, candidates: [] },
        coverage: {
          status: 'empty',
          reason: `No Chinese medicine product matched "${query}".`,
        },
        timeRange: { timezone: 'UTC', startDate: null, endDate: null },
        confidence: {
          level: 'low',
          reason: 'No matching Chinese medicine product.',
        },
        ambiguities: [],
        tables: ['cn_medicine_products'],
      });
    }

    if (search.items.length > 1) {
      return buildReadEnvelope({
        toolName: 'get_cn_medicine_detail',
        query: {
          query,
          matchedSource: 'cn',
          candidateCount: search.items.length,
        },
        result: {
          product: null,
          candidates: toCandidates(search.items),
        },
        coverage: {
          status: 'partial',
          reason: `Multiple Chinese medicine products matched "${query}".`,
        },
        timeRange: { timezone: 'UTC', startDate: null, endDate: null },
        confidence: {
          level: 'low',
          reason:
            'Multiple Chinese medicine products matched the query, so one detail record could not be chosen safely.',
        },
        ambiguities: extractCandidateNames(search.items),
        tables: ['cn_medicine_products'],
      });
    }

    const product = search.items[0];
    if (product == null) {
      return buildReadEnvelope({
        toolName: 'get_cn_medicine_detail',
        query: { query, matchedSource: 'cn' },
        result: { product: null, candidates: [] },
        coverage: { status: 'empty', reason: 'No product resolved.' },
        timeRange: { timezone: 'UTC', startDate: null, endDate: null },
        confidence: { level: 'low', reason: 'No product resolved.' },
        ambiguities: [],
        tables: ['cn_medicine_products'],
      });
    }

    return this.buildCnDetailById(product.id, query);
  }

  async getDrugbankDetail(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    const payload = parseLookupPayload(context.userMessage, this.logger);
    const directId = payload.drugbankId;
    const query = payload.query.trim();

    if (directId) {
      return this.buildDrugbankDetailById(directId, query);
    }

    if (!query) {
      return buildReadEnvelope({
        toolName: 'get_drugbank_detail',
        query: { query, matchedSource: 'drugbank' },
        result: { drug: null, candidates: [] },
        coverage: {
          status: 'empty',
          reason: 'No DrugBank query was provided.',
        },
        timeRange: { timezone: 'UTC', startDate: null, endDate: null },
        confidence: { level: 'low', reason: 'Empty query.' },
        ambiguities: [],
        tables: ['drugbank_drugs'],
      });
    }

    const search = await this.drugbankMedicinesService.search({
      q: query,
      page: 1,
      pageSize: DETAIL_RESOLVE_LIMIT,
    });

    if (search.items.length === 0) {
      return buildReadEnvelope({
        toolName: 'get_drugbank_detail',
        query: { query, matchedSource: 'drugbank' },
        result: { drug: null, candidates: [] },
        coverage: {
          status: 'empty',
          reason: `No DrugBank entity matched "${query}".`,
        },
        timeRange: { timezone: 'UTC', startDate: null, endDate: null },
        confidence: { level: 'low', reason: 'No matching DrugBank entity.' },
        ambiguities: [],
        tables: ['drugbank_drugs'],
      });
    }

    if (search.items.length > 1) {
      return buildReadEnvelope({
        toolName: 'get_drugbank_detail',
        query: {
          query,
          matchedSource: 'drugbank',
          candidateCount: search.items.length,
        },
        result: {
          drug: null,
          candidates: toCandidates(search.items),
        },
        coverage: {
          status: 'partial',
          reason: `Multiple DrugBank entities matched "${query}".`,
        },
        timeRange: { timezone: 'UTC', startDate: null, endDate: null },
        confidence: {
          level: 'low',
          reason:
            'Multiple DrugBank entities matched the query, so one detail record could not be chosen safely.',
        },
        ambiguities: extractCandidateNames(search.items),
        tables: ['drugbank_drugs'],
      });
    }

    const drug = search.items[0];
    if (drug == null) {
      return buildReadEnvelope({
        toolName: 'get_drugbank_detail',
        query: { query, matchedSource: 'drugbank' },
        result: { drug: null, candidates: [] },
        coverage: { status: 'empty', reason: 'No DrugBank entity resolved.' },
        timeRange: { timezone: 'UTC', startDate: null, endDate: null },
        confidence: { level: 'low', reason: 'No DrugBank entity resolved.' },
        ambiguities: [],
        tables: ['drugbank_drugs'],
      });
    }

    return this.buildDrugbankDetailById(drug.id, query);
  }

  private async buildCnDetailById(
    productId: string,
    query: string,
  ): Promise<AssistantReadResultEnvelope> {
    const detail = await this.cnMedicinesService.getDetail(productId);

    if (!detail) {
      return buildReadEnvelope({
        toolName: 'get_cn_medicine_detail',
        query: { query, matchedSource: 'cn', productId },
        result: { product: null, candidates: [] },
        coverage: {
          status: 'empty',
          reason: `No Chinese medicine detail was found for "${productId}".`,
        },
        timeRange: { timezone: 'UTC', startDate: null, endDate: null },
        confidence: {
          level: 'low',
          reason: 'Resolved product id has no detail row.',
        },
        ambiguities: [],
        tables: ['cn_medicine_products'],
      });
    }

    return buildReadEnvelope({
      toolName: 'get_cn_medicine_detail',
      query: {
        query,
        matchedSource: 'cn',
        productId,
      },
      result: { product: detail, candidates: [] },
      coverage: { status: 'complete', reason: null },
      timeRange: { timezone: 'UTC', startDate: null, endDate: null },
      confidence: buildReadConfidence({
        ambiguities: [],
        preferredReason:
          'Loaded one structured Chinese medicine detail record from Lucent tables.',
      }),
      ambiguities: [],
      tables: ['cn_medicine_products'],
    });
  }

  private async buildDrugbankDetailById(
    drugbankId: string,
    query: string,
  ): Promise<AssistantReadResultEnvelope> {
    const detail = await this.drugbankMedicinesService.getDetail(drugbankId);

    if (!detail) {
      return buildReadEnvelope({
        toolName: 'get_drugbank_detail',
        query: { query, matchedSource: 'drugbank', drugbankId },
        result: { drug: null, candidates: [] },
        coverage: {
          status: 'empty',
          reason: `No DrugBank detail was found for "${drugbankId}".`,
        },
        timeRange: { timezone: 'UTC', startDate: null, endDate: null },
        confidence: {
          level: 'low',
          reason: 'Resolved DrugBank id has no detail row.',
        },
        ambiguities: [],
        tables: ['drugbank_drugs'],
      });
    }

    return buildReadEnvelope({
      toolName: 'get_drugbank_detail',
      query: {
        query,
        matchedSource: 'drugbank',
        drugbankId,
      },
      result: { drug: detail, candidates: [] },
      coverage: { status: 'complete', reason: null },
      timeRange: { timezone: 'UTC', startDate: null, endDate: null },
      confidence: buildReadConfidence({
        ambiguities: [],
        preferredReason:
          'Loaded one structured DrugBank detail record from Lucent tables.',
      }),
      ambiguities: [],
      tables: ['drugbank_drugs'],
    });
  }
}

function normalizeLimit(limit: number | undefined): number {
  if (limit == null || Number.isNaN(limit)) return DEFAULT_SEARCH_LIMIT;
  return Math.max(1, Math.min(MAX_SEARCH_LIMIT, Math.trunc(limit)));
}

function parseLookupPayload(
  raw: string,
  logger: Logger,
): {
  query: string;
  limit: number | undefined;
  productId: string | null;
  drugbankId: string | null;
} {
  const base = parseSearchPayload(raw, logger);
  const trimmed = raw.trim();

  if (!trimmed.startsWith('{')) {
    return {
      query: base.query,
      limit: base.limit,
      productId: readString(base.filters['productId']),
      drugbankId: readString(base.filters['drugbankId']),
    };
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const id = readString(parsed['id']);
    return {
      query: base.query,
      limit: base.limit,
      productId:
        readString(parsed['productId']) ??
        readString(base.filters['productId']) ??
        id,
      drugbankId:
        readString(parsed['drugbankId']) ??
        readString(base.filters['drugbankId']) ??
        id,
    };
  } catch (error) {
    logger.warn(
      `Failed to parse lookup payload, returning base query: ${error instanceof Error ? error.message : String(error)}`,
    );
    return {
      query: base.query,
      limit: base.limit,
      productId: readString(base.filters['productId']),
      drugbankId: readString(base.filters['drugbankId']),
    };
  }
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function toCandidates(items: MedicineSearchItemDto[]) {
  return items.map((item) => ({
    id: item.id,
    source: item.source,
    name: item.name,
    subtitle: item.subtitle,
    matchedBy: item.matchedBy,
  }));
}

function extractCandidateNames(items: MedicineSearchItemDto[]): string[] {
  return items.map((item) => item.name);
}
