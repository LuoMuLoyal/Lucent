/**
 * Medicine detail read model (`application/read_models`).
 *
 * `GET /medicines/:id` is a **projection**, not an entity: it is assembled
 * from one knowledge source row and carries no invariant (ADR-0024 §4). The
 * read model's job here is narrower than "fetch and return" — it owns the two
 * decisions the detail endpoint makes on top of the raw row:
 *
 * 1. **source selection** — `source` is a request parameter, never
 *    `Accept-Language` (ADR-0008), and an unknown value is a validation
 *    failure, not a silent fallback;
 * 2. **read-through caching** — the bypass header applies to this request
 *    only, and a cache miss warms the shared knowledge cache.
 *
 * It exposes no write path, keeps no state, and has no repository.
 */

import { Inject, Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';

import {
  createDomainFailure,
  errAsync,
  fromPromise,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';
import {
  CN_MEDICINES_READER,
  DRUGBANK_MEDICINES_READER,
  MEDICINES_KNOWLEDGE_CACHE,
  type MedicinesKnowledgeCachePort,
  type MedicinesSourceReader,
} from '../ports/knowledge.js';
import type { MedicineDetailView } from '../ports/knowledge-view.js';
import {
  DEFAULT_MEDICINE_SOURCE,
  type MedicineKnowledgeSource,
} from '../../domain/medicine/medicine-source.js';

/** Query shaped by `GET /medicines/:id`. */
export interface MedicineDetailQuery {
  source?: string | undefined;
}

/**
 * Resolves the `source` request parameter to a knowledge source.
 *
 * Shared with the sequence read model: both endpoints take the same selector
 * and must answer the same way when it is absent or unknown.
 */
export function resolveMedicineSource(
  source: string | undefined,
  i18n: I18nService,
): ResultAsync<MedicineKnowledgeSource, DomainFailure> {
  if (source === undefined || source.trim() === '') {
    return okAsync(DEFAULT_MEDICINE_SOURCE);
  }

  if (source === 'drugbank' || source === 'cn') {
    return okAsync(source);
  }

  return errAsync(
    createDomainFailure({
      kind: 'validation',
      code: 'VALIDATION_FAILED',
      detail: i18n.t('medicine.source_invalid'),
    }),
  );
}

/** Maps a nullable source result onto `not_found`; shared by both read models. */
export function ensureFound<T>(
  value: T | null,
  i18n: I18nService,
): ResultAsync<T, DomainFailure> {
  if (!value) {
    return errAsync(
      createDomainFailure({
        kind: 'not_found',
        code: 'RESOURCE_NOT_FOUND',
        detail: i18n.t('medicine.not_found'),
      }),
    );
  }
  return okAsync(value);
}

/** Wraps a cache/reader rejection as the module's standard internal failure. */
export function asInternalFailure(error: unknown): DomainFailure {
  return createDomainFailure({
    kind: 'internal',
    code: 'INTERNAL_ERROR',
    cause: error instanceof Error ? error : undefined,
  });
}

/**
 * One medicine's detail.
 *
 * The `source` default is DrugBank (the English scientific entity used by the
 * personal-health copilot); CN is the product-catalogue source with leaflet
 * body text. There is no cross-source bridging at runtime — a fact the
 * response makes explicit by keeping each source's native fields.
 */
@Injectable()
export class MedicineDetailReadModel {
  constructor(
    @Inject(DRUGBANK_MEDICINES_READER)
    private readonly drugbankReader: MedicinesSourceReader<MedicineDetailView>,
    @Inject(CN_MEDICINES_READER)
    private readonly cnReader: MedicinesSourceReader<MedicineDetailView>,
    @Inject(MEDICINES_KNOWLEDGE_CACHE)
    private readonly knowledgeCache: MedicinesKnowledgeCachePort,
    private readonly i18n: I18nService,
  ) {}

  /** Detail as the plain read path sees it (never bypasses the cache). */
  get(
    id: string,
    query: MedicineDetailQuery,
  ): ResultAsync<MedicineDetailView, DomainFailure> {
    return this.getWithCache(id, query, false);
  }

  /**
   * Detail through the read-through cache.
   *
   * `bypassCache` is per-request: it streams past the cached copy but still
   * refreshes it, so a single "give me the current truth" request does not
   * leave the cache stale for the next caller.
   */
  getWithCache(
    id: string,
    query: MedicineDetailQuery,
    bypassCache: boolean,
  ): ResultAsync<MedicineDetailView, DomainFailure> {
    return resolveMedicineSource(query.source, this.i18n).andThen((source) => {
      const normalizedId = id.trim();

      return fromPromise(
        this.knowledgeCache.getOrSetDetail(
          source,
          normalizedId,
          bypassCache,
          () =>
            source === 'drugbank'
              ? this.drugbankReader.getDetail(normalizedId)
              : this.cnReader.getDetail(normalizedId),
        ),
        asInternalFailure,
      ).andThen((detail) => ensureFound(detail, this.i18n));
    });
  }
}
