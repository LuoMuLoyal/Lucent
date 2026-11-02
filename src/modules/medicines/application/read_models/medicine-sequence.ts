/**
 * Medicine sequence read model (`application/read_models`).
 *
 * `GET /medicines/:id/sequences` is deliberately separate from the detail
 * projection: one well-studied drug carries ~96 KB of sequence (Imatinib: 28
 * targets × 2 datasets), which has no business riding along with every detail
 * request. The client asks for it only when the user expands the sequence
 * section.
 *
 * Only DrugBank carries sequences; the CN product source is a leaflet database
 * with no sequence columns, so it answers with an **empty set rather than a
 * 404** — the medicine itself does exist. That distinction lives in the CN
 * reader (`getSequences` returns the empty projection), not here.
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
  type MedicinesKnowledgeCachePort,
  type MedicinesSourceReader,
} from '../ports/knowledge.js';
import type { MedicineSequenceView } from '../ports/knowledge-view.js';
import type { MedicineDetailView } from '../ports/knowledge-view.js';
import {
  asInternalFailure,
  ensureFound,
  resolveMedicineSource,
  type MedicineDetailQuery,
} from './medicine-detail.js';

/** Sequences of one medicine, fetched lazily on top of the same cache. */
@Injectable()
export class MedicineSequenceReadModel {
  constructor(
    @Inject(DRUGBANK_MEDICINES_READER)
    private readonly drugbankReader: MedicinesSourceReader<MedicineDetailView>,
    @Inject(CN_MEDICINES_READER)
    private readonly cnReader: MedicinesSourceReader<MedicineDetailView>,
    @Inject(MEDICINES_KNOWLEDGE_CACHE)
    private readonly knowledgeCache: MedicinesKnowledgeCachePort,
    private readonly i18n: I18nService,
  ) {}

  /**
   * Sequences through the read-through cache.
   *
   * The sequence cache entry reuses the detail TTL: sequences are imported and
   * invalidated together with the catalogue, so they have no separate lifetime.
   */
  get(
    id: string,
    query: MedicineDetailQuery,
    bypassCache: boolean,
  ): ResultAsync<MedicineSequenceView, DomainFailure> {
    return resolveMedicineSource(query.source, this.i18n).andThen((source) => {
      const normalizedId = id.trim();

      return fromPromise(
        this.knowledgeCache.getOrSetSequences(
          source,
          normalizedId,
          bypassCache,
          () =>
            source === 'drugbank'
              ? this.drugbankReader.getSequences(normalizedId)
              : this.cnReader.getSequences(normalizedId),
        ),
        asInternalFailure,
      ).andThen((sequences) => ensureFound(sequences, this.i18n));
    });
  }
}
