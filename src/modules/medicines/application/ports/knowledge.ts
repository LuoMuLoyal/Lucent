/**
 * Knowledge read path contracts (ADR-0024 `application/ports`).
 *
 * The application layer never touches `infrastructure/` or `adapters/` classes
 * directly — the medicines module wires these tokens to their concrete
 * implementations in `medicines.module.ts`.
 */

import type { MedicineKnowledgeSource } from '../../domain/medicine/medicine_source.js';
import type { MedicineDetailDataLike } from '../../domain/services/ingredient_canonicalization.js';

export const MEDICINES_KNOWLEDGE_CACHE = 'MEDICINES_KNOWLEDGE_CACHE';
export const CN_MEDICINES_READER = 'CN_MEDICINES_READER';
export const DRUGBANK_MEDICINES_READER = 'DRUGBANK_MEDICINES_READER';

export type { MedicineDetailDataLike };

/** Wrapper payload of one drugbank/cn medicine detail response. */
export type MedicineDetailData = MedicineDetailDataLike;

/** Sequences of one medicine, as built by the Knowledge persistence layer. */
export type MedicineSequenceData = {
  id: string;
  source: MedicineKnowledgeSource;
  drug: unknown[];
  targets: unknown[];
};

export type MedicineSearchCriteria = {
  q: string;
  page: number;
  pageSize: number;
};

/**
 * Search result shape as returned by both knowledge readers.
 *
 * The item shape mirrors the wire contract validated by
 * `adapters/http/dto/search.ts`; it is declared here because the application
 * layer (and cross-context reader callers) must not import adapter DTOs. The
 * zod schema remains the single source of truth for what goes over HTTP.
 */
export type MedicineSearchItemLike = {
  id: string;
  source: string;
  name: string;
  subtitle: string | null;
  summary: string | null;
  tags: string[];
  imageUrl: string | null;
  matchedBy: string[];
};

export type MedicineSearchResultLike = {
  items: MedicineSearchItemLike[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

/**
 * One knowledge source (CN or DrugBank) as seen from the application layer.
 * `D` is the detail wrapper contract — constrained from the domain side so
 * risk-check context building keeps its structural guarantees.
 */
export interface MedicinesSourceReader<D = unknown> {
  search(criteria: MedicineSearchCriteria): Promise<MedicineSearchResultLike>;
  getDetail(id: string): Promise<D | null>;
  getSequences(id: string): Promise<unknown>;
}

/** Read-through cache facade over the knowledge endpoints. */
export interface MedicinesKnowledgeCachePort {
  getOrSetSearch<R>(
    input: { source: string } & MedicineSearchCriteria,
    bypass: boolean,
    load: () => Promise<R>,
  ): Promise<R>;

  getOrSetDetail<R>(
    source: string,
    id: string,
    bypass: boolean,
    load: () => Promise<R | null>,
  ): Promise<R | null>;

  /** Sequences reuse the detail TTL: they are imported and invalidated with the catalogue. */
  getOrSetSequences<R>(
    source: string,
    id: string,
    bypass: boolean,
    load: () => Promise<R | null>,
  ): Promise<R | null>;
}
