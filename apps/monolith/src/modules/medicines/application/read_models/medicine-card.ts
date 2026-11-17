/**
 * Search-card read model (`application/read_models`).
 *
 * `GET /medicines` returns a page of cards: a **projection**, not an entity.
 * It carries what the list UI needs to render a row and nothing that would
 * imply an invariant (ADR-0024 §4 — read models never get a repository or a
 * write path).
 *
 * This file owns the query shape and the page-level contract; the
 * field-formatting helpers that build a single card are shared with the
 * persistence layer through `medicine-card.format.ts`.
 */

import { Inject, Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';

import {
  fromPromise,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';
import {
  CN_MEDICINES_READER,
  DRUGBANK_MEDICINES_READER,
  MEDICINES_KNOWLEDGE_CACHE,
  type MedicineSearchCriteria,
  type MedicineSearchResultLike,
  type MedicinesKnowledgeCachePort,
  type MedicinesSourceReader,
} from '../ports/knowledge.js';
import type { MedicineCard, MedicinePage } from '../ports/knowledge-view.js';
import type { MedicineDetailView } from '../ports/knowledge-view.js';
import { asInternalFailure, resolveMedicineSource } from './medicine-detail.js';

export type { MedicineCard, MedicinePage };

/** Query shaped by `GET /medicines`. */
export interface MedicineSearchQuery {
  q?: string | undefined;
  page: number;
  pageSize: number;
  source?: string | undefined;
}

/** One page of search cards plus the pagination echo. */
export interface MedicineCardPage {
  items: MedicineCard[];
  pagination: MedicinePage;
}

/**
 * One page of search cards.
 *
 * `q` is trimmed before it reaches the cache key: an untrimmed query would
 * mint a separate cache entry for every incidental trailing space while
 * returning the same page. The empty query is not special-cased — it browses
 * the catalogue, which is exactly what the source does with `q = ''`.
 */
@Injectable()
export class MedicineSearchReadModel {
  constructor(
    @Inject(DRUGBANK_MEDICINES_READER)
    private readonly drugbankReader: MedicinesSourceReader<MedicineDetailView>,
    @Inject(CN_MEDICINES_READER)
    private readonly cnReader: MedicinesSourceReader<MedicineDetailView>,
    @Inject(MEDICINES_KNOWLEDGE_CACHE)
    private readonly knowledgeCache: MedicinesKnowledgeCachePort,
    private readonly i18n: I18nService,
  ) {}

  /** Search as the plain read path sees it (never bypasses the cache). */
  search(
    query: MedicineSearchQuery,
  ): ResultAsync<MedicineSearchResultLike, DomainFailure> {
    return this.searchWithCache(query, false);
  }

  /** Search through the read-through cache; `bypassCache` is per-request. */
  searchWithCache(
    query: MedicineSearchQuery,
    bypassCache: boolean,
  ): ResultAsync<MedicineSearchResultLike, DomainFailure> {
    return resolveMedicineSource(query.source, this.i18n).andThen((source) => {
      const criteria: MedicineSearchCriteria = {
        q: query.q?.trim() ?? '',
        page: query.page,
        pageSize: query.pageSize,
      };

      return fromPromise(
        this.knowledgeCache.getOrSetSearch(
          {
            source,
            ...criteria,
          },
          bypassCache,
          () =>
            source === 'drugbank'
              ? this.drugbankReader.search(criteria)
              : this.cnReader.search(criteria),
        ),
        asInternalFailure,
      );
    });
  }
}
