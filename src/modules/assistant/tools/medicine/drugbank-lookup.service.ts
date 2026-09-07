import { Injectable, Logger } from '@nestjs/common';
import type { AssistantReadResultEnvelope } from '../../types/assistant.types.js';
import type { AssistantToolExecutionContext } from '../../types/assistant.types.js';
import { DrugbankMedicinesService } from '../../../medicines/index.js';
import { buildReadConfidence, buildReadEnvelope } from '../presenters.js';
import { parseLookupPayload } from './lookup.service.js';

const DETAIL_RESOLVE_LIMIT = 5;

/**
 * DrugBank-specific detail lookup for the assistant tool layer.
 *
 * Extracted from `AssistantToolMedicineLookupService` to isolate the
 * DrugBank search-and-resolve flow from the CN medicine logic.
 */
@Injectable()
export class AssistantDrugbankLookupService {
  private readonly logger = new Logger(AssistantDrugbankLookupService.name);

  constructor(
    private readonly drugbankMedicinesService: DrugbankMedicinesService,
  ) {}

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

// ── Shared helpers (duplicated from lookup.service.ts) ──────────────

function toCandidates(
  items: Array<{
    id: string;
    source: string;
    name: string;
    subtitle: string | null;
    matchedBy: string[];
  }>,
) {
  return items.map((item) => ({
    id: item.id,
    source: item.source,
    name: item.name,
    subtitle: item.subtitle,
    matchedBy: item.matchedBy,
  }));
}

function extractCandidateNames(items: Array<{ name: string }>): string[] {
  return items.map((item) => item.name);
}
