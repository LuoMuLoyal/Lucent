import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/index.js';
import type {
  AssistantReadResultEnvelope,
  AssistantToolExecutionContext,
} from '../../types/assistant.types.js';
import { buildReadConfidence, buildReadEnvelope } from '../presenters.js';

const DRUGBANK_ENTITY_LIMIT = 5;

@Injectable()
export class AssistantToolDrugbankEntityResolveService {
  private readonly logger = new Logger(
    AssistantToolDrugbankEntityResolveService.name,
  );

  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    const query = resolveEntityQuery(context, this.logger);

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
          { drugbankId: { equals: query, mode: 'insensitive' } },
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

    // 唯一化：**精确命中优先**。
    //
    // `contains` 会把原药与它的酯/盐一起带回来：查 "dexamethasone" 得到
    // DB01234 / DB14649（乙酸酯）/ DB19168（棕榈酸酯）。旧实现在 `length > 1` 时直接判
    // `partial`，于是 `search_drugbank_passages` 的 `resolveSingleDrugbankId` 永远拿不到
    // 作用域、段落检索永远返回空 —— 生产实测的"英文也返回零个"就有这一层。
    // 精确同名（或精确 drugbank id）是确定性判据，不算歧义；其余多命中仍然如实报 partial。
    const exact =
      entities.find(
        (entity) => entity.drugbankId.toLowerCase() === query.toLowerCase(),
      ) ??
      entities.find(
        (entity) => entity.name.toLowerCase() === query.toLowerCase(),
      );
    const entity = exact ?? (entities.length === 1 ? entities[0] : null);

    if (entity == null) {
      return buildReadEnvelope({
        toolName: 'resolve_drugbank_entity',
        query: { query, matchedBy: ['name', 'searchText'] },
        result: {
          entities: entities.map((candidate) => ({
            drugbankId: candidate.drugbankId,
            name: candidate.name,
            casNumber: candidate.casNumber,
            unii: candidate.unii,
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
        ambiguities: entities.map((candidate) => candidate.name),
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

/**
 * 取"要解析哪个药"。
 *
 * 优先模型给的 `toolArgs.query`（参数已声明，见 `tools/shared/tool-definitions.ts` 的
 * `DRUGBANK_ENTITY_PARAMETERS`）；缺失才回退到对 `userMessage` 的历史解析。
 *
 * 回退路径是本条链路的头号故障源：`userMessage` 是**用户原句**，整句当 SQL `contains`
 * 的模式必然 0 行 —— 2026-10-07 生产实测（"查了英文显示零个，换成英文还是零个"）：
 * 整句 0 行，而 `'%ibuprofen%'` 3 行。保留回退只是不让未声明参数的旧调用路径直接崩。
 */
export function resolveEntityQuery(
  context: AssistantToolExecutionContext,
  logger: Logger,
): string {
  const args = context.toolArgs ?? {};
  const fromArgs =
    typeof args['query'] === 'string' ? args['query'].trim() : '';
  if (fromArgs.length > 0) {
    return fromArgs;
  }
  return parseSearchPayload(context.userMessage, logger).query.trim();
}

export function parseSearchPayload(
  raw: string,
  logger: Logger,
): {
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
    logger.warn(
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
