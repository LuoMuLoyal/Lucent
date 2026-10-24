/**
 * Write-side repository port for the `RiskAssessment` aggregate
 * (`domain/safety/risk-assessments.ts`, per ADR-0024 §4).
 *
 * ADR-0024: one repository per aggregate root, serving **load/save for the
 * write side only** — no query DSL, no read projections. The read paths
 * (`GET risk-check` latest records) keep using the existing
 * `application/ports/risk-records.ts`, which is a read-model port, not a
 * repository for this aggregate.
 *
 * ## The transaction parameter
 *
 * `save` takes an opaque transaction handle so the caller can persist the
 * aggregate **and** append its domain event in one transaction. The handle is
 * `unknown` on purpose: `domain/` may not import Prisma (ADR-0024 layer rule
 * D1), so the concrete client type is narrowed by the implementation in
 * `infrastructure/persistence/`. A caller that does not need atomicity simply
 * omits it.
 */

import type { RiskAssessment, RiskCheckKind } from './risk-assessment.js';

/** One persisted assessment, as the write side sees it. */
export interface RiskAssessmentRecord {
  id: string;
  userId: string;
  checkType: RiskCheckKind;
  /** 0–100, derived by the aggregate for static checks. */
  riskScore: number;
  /** `safe` | `caution` | `risk` | `danger`. */
  riskLevel: string;
  stale: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Opaque transaction handle.
 *
 * Domain code passes it through without inspecting it; the infrastructure
 * implementation narrows it to its own client type. This keeps the atomicity
 * contract visible in the domain without leaking a persistence framework into
 * the domain layer.
 */
export type RiskAssessmentTransaction = unknown;

export interface RiskAssessmentStore {
  /**
   * Persists a completed assessment.
   *
   * Upsert semantics follow the table's `@@unique([userId, checkType])`: a user
   * has at most one static and one LLM assessment, so "save" means "replace the
   * current one". The aggregate itself is immutable after completion — there is
   * deliberately no partial-update path.
   */
  save(
    assessment: RiskAssessment,
    tx?: RiskAssessmentTransaction,
  ): Promise<RiskAssessmentRecord>;

  /** Existing assessments for a user, newest first (write-side rehydration). */
  findByUser(userId: string): Promise<RiskAssessmentRecord[]>;
}
