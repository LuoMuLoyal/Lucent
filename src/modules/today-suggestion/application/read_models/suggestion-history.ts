/**
 * Suggestion history (`application/read_models`).
 *
 * The Report page's history list. Two things happen here on top of the query:
 *
 * 1. **Deduplication by `ruleId + subtype`** — the same rule can produce several
 *    cards for the same day as it evolves, and history shows one row per rule
 *    instance. Which row survives is decided by `lifecycleRank` (the domain's
 *    "how current is this state" ladder): an `active` card beats a `dismissed`
 *    one beats an `expired` one.
 * 2. **DTO shaping** — ISO timestamps, optional fields omitted rather than
 *    `null`, so the wire shape stays stable for generated clients.
 *
 * Caching stays in the calling service: it is an orchestration concern, and
 * keeping it out means this class stays a pure projection.
 */

import { Inject, Injectable } from '@nestjs/common';

import { lifecycleRank } from '../../domain/suggestion/daily-suggestion.js';
import type { SuggestionHistoryItemDto } from '../../dto/suggestion-history-query.dto.js';
import { SUGGESTION_QUERY_PORT } from '../ports/suggestion-queries.js';
import type {
  SuggestionHistoryQuery,
  SuggestionHistoryRow,
  SuggestionQueryPort,
} from '../ports/suggestion-queries.js';

/** Paginated history plus the unpaged total for the same filters. */
export interface SuggestionHistoryPage {
  items: SuggestionHistoryItemDto[];
  total: number;
}

/** Builds the Report page's history projection. */
@Injectable()
export class SuggestionHistoryReadModel {
  constructor(
    @Inject(SUGGESTION_QUERY_PORT)
    private readonly queries: SuggestionQueryPort,
  ) {}

  async getHistory(
    query: SuggestionHistoryQuery,
  ): Promise<SuggestionHistoryPage> {
    const { rows, total } = await this.queries.findHistory(query);

    // One row per `ruleId + subtype`: keep the most current lifecycle state.
    const byKey = new Map<string, SuggestionHistoryRow>();
    for (const row of rows) {
      const key = `${row.ruleId}:${row.subtype ?? ''}`;
      const existing = byKey.get(key);
      if (
        existing == null ||
        lifecycleRank(existing.lifecycleState) <
          lifecycleRank(row.lifecycleState)
      ) {
        byKey.set(key, row);
      }
    }

    return {
      items: [...byKey.values()].map(toDto),
      total,
    };
  }
}

function toDto(row: SuggestionHistoryRow): SuggestionHistoryItemDto {
  return {
    id: row.id,
    date: row.date,
    type: row.type as SuggestionHistoryItemDto['type'],
    title: row.title,
    reason: row.reason,
    ruleId: row.ruleId,
    ruleVersion: row.ruleVersion,
    triggerType: row.triggerType as SuggestionHistoryItemDto['triggerType'],
    lifecycleState:
      row.lifecycleState as SuggestionHistoryItemDto['lifecycleState'],
    confidence: row.confidence as SuggestionHistoryItemDto['confidence'],
    subtype: row.subtype ?? undefined,
    feedback: row.feedback ?? undefined,
    feedbackAt: row.feedbackAt?.toISOString() ?? undefined,
    generatedAt: row.generatedAt.toISOString(),
    expiredAt: row.expiredAt?.toISOString() ?? undefined,
  };
}
