import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma';
import type {
  AssistantReadResultEnvelope,
  AssistantToolExecutionContext,
} from '../../types/assistant.types';
import { buildReadConfidence, buildReadEnvelope } from '../presenters';

const DRUGBANK_ENTITY_LIMIT = 5;

@Injectable()
export class AssistantToolDrugbankEntityResolveService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    const payload = parseSearchPayload(context.userMessage);
    const query = payload.query.trim();

    if (!query) {
      return buildReadEnvelope({
        toolName: 'resolve_drugbank_entity',
        query: { query },
        result: { entities: [] },
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

    const entities = await this.prisma.drugbankDrug.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { casNumber: { contains: query, mode: 'insensitive' } },
          { unii: { contains: query, mode: 'insensitive' } },
          { searchText: { contains: query, mode: 'insensitive' } },
        ],
      },
      orderBy: [{ name: 'asc' }],
      take: DRUGBANK_ENTITY_LIMIT,
      select: {
        drugbankId: true,
        name: true,
        casNumber: true,
        unii: true,
      },
    });

    if (entities.length === 0) {
      return buildReadEnvelope({
        toolName: 'resolve_drugbank_entity',
        query: { query },
        result: { entities: [] },
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

    if (entities.length > 1) {
      return buildReadEnvelope({
        toolName: 'resolve_drugbank_entity',
        query: { query, matchedBy: ['name', 'searchText'] },
        result: {
          entities: entities.map((entity) => ({
            drugbankId: entity.drugbankId,
            name: entity.name,
            casNumber: entity.casNumber,
            unii: entity.unii,
          })),
        },
        coverage: {
          status: 'partial',
          reason: `Multiple DrugBank entities matched "${query}".`,
        },
        timeRange: { timezone: 'UTC', startDate: null, endDate: null },
        confidence: {
          level: 'low',
          reason: 'Multiple candidate DrugBank entities matched the query.',
        },
        ambiguities: entities.map((entity) => entity.name),
        tables: ['drugbank_drugs'],
      });
    }

    const [entity] = entities;
    if (entity == null) {
      return buildReadEnvelope({
        toolName: 'resolve_drugbank_entity',
        query: { query },
        result: { entities: [] },
        coverage: { status: 'empty', reason: 'No entity resolved.' },
        timeRange: { timezone: 'UTC', startDate: null, endDate: null },
        confidence: { level: 'low', reason: 'No entity resolved.' },
        ambiguities: [],
        tables: ['drugbank_drugs'],
      });
    }

    return buildReadEnvelope({
      toolName: 'resolve_drugbank_entity',
      query: {
        query,
        matchedBy: ['name', 'searchText'],
        resolvedDrugbankId: entity.drugbankId,
      },
      result: {
        entities: [
          {
            drugbankId: entity.drugbankId,
            name: entity.name,
            casNumber: entity.casNumber,
            unii: entity.unii,
          },
        ],
      },
      coverage: { status: 'complete', reason: null },
      timeRange: { timezone: 'UTC', startDate: null, endDate: null },
      confidence: buildReadConfidence({
        ambiguities: [],
        preferredReason: 'Resolved one DrugBank entity from local Lucent data.',
      }),
      ambiguities: [],
      tables: ['drugbank_drugs'],
    });
  }
}

export function parseSearchPayload(raw: string): {
  query: string;
  limit?: number;
  cursor?: string | null;
  filters: Record<string, unknown>;
} {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) {
    return {
      query: trimmed,
      filters: {},
    };
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const result: {
      query: string;
      limit?: number;
      cursor?: string | null;
      filters: Record<string, unknown>;
    } = {
      query:
        typeof parsed['query'] === 'string'
          ? parsed['query']
          : typeof parsed['medicineQuery'] === 'string'
            ? parsed['medicineQuery']
            : trimmed,
      filters: toRecord(parsed['filters']),
    };

    if (typeof parsed['limit'] === 'number') {
      result.limit = Math.trunc(parsed['limit']);
    }

    if (typeof parsed['cursor'] === 'string') {
      result.cursor = parsed['cursor'];
    } else {
      result.cursor = null;
    }

    return result;
  } catch (error) {
    console.warn(
      `Failed to parse drugbank entity resolve payload, returning base query: ${error instanceof Error ? error.message : String(error)}`,
    );
    return {
      query: trimmed,
      filters: {},
    };
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value != null && typeof value === 'object') {
    return value as Record<string, unknown>;
  }

  return {};
}
