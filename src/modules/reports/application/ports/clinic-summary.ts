/**
 * Persistence ports for the clinic-summary subdomain (ADR-0024 D2).
 *
 * `application/` may not touch Prisma or `infrastructure/`, so both use cases
 * reach storage through these ports. Implementations live in
 * `infrastructure/persistence/` and are bound with `useExisting`.
 *
 * ## Why no aggregate
 *
 * A share's lifecycle is **derived, not stored**: it is valid iff
 * `revokedAt === null && expiresAt > now`. There is no `status` column and no
 * closed set of states, so there is nothing for an aggregate to guard — the
 * same judgement `today-suggestion` made for its materialization table
 * ("`stale` is a projection, not a state"). What *is* domain logic is the
 * predicate itself: {@link isShareAccessible}. It lives in `domain/clinic-summary/`
 * so both the read path and the guards call one definition instead of each
 * spelling out the condition.
 */

import type { UserClinicSummaryShare } from '#generated/prisma/client.js';

/** Injection token for {@link ClinicSummaryShares}. */
export const CLINIC_SUMMARY_SHARES = Symbol('ClinicSummaryShares');

/** Persistence surface of `user_clinic_summary_share`. */
export interface ClinicSummaryShares {
  /** Persists a new share row and returns it. */
  create(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    eventId: string | null;
    /** `@db.Date` columns — the row stores dates, not ISO strings. */
    dateFrom: Date | null;
    dateTo: Date | null;
    selectedFields: string[];
  }): Promise<UserClinicSummaryShare>;

  /** Resolves an accessible (unrevoked, unexpired) share by token hash. */
  findAccessibleByTokenHash(
    tokenHash: string,
    at: Date,
  ): Promise<UserClinicSummaryShare | null>;

  /**
   * Finds a share by token hash **without** the accessibility filter.
   *
   * Distinct from {@link findAccessibleByTokenHash} on purpose: the cached-copy
   * path needs to tell "no row at all (legacy pre-persistence share)" apart
   * from "row exists but revoked/expired". Collapsing the two would let a
   * revoked share keep serving its cached copy.
   */
  findByTokenHash(tokenHash: string): Promise<UserClinicSummaryShare | null>;

  /**
   * Records one access atomically, re-checking accessibility in the `WHERE`.
   *
   * `firstAccessedAt` is set only when the row has none yet — that condition
   * belongs in the same `WHERE` as the accessibility re-check, so two
   * concurrent reads cannot both claim to be "first". Returns the share as it
   * stood *before* the increment (the caller adds one), or `null` when the
   * re-check rejects it: that is the read/write race closing, not an error.
   */
  recordAccess(
    shareId: string,
    at: Date,
  ): Promise<UserClinicSummaryShare | null>;

  /** Every share owned by the user, newest first (revoked included). */
  listByUser(userId: string): Promise<UserClinicSummaryShare[]>;

  /** Ownership-scoped revoke; `false` for unknown ids or non-owners. */
  revoke(userId: string, shareId: string, at: Date): Promise<boolean>;
}

/** Injection token for {@link ClinicSummarySources}. */
export const CLINIC_SUMMARY_SOURCES = Symbol('ClinicSummarySources');

/**
 * Persistence surface for the parts of the summary that are `user`'s own data.
 *
 * Everything *health-related* (allergies, conditions, current medicines,
 * birth date, sex at birth) is deliberately **not** here: it belongs to
 * `user-health-context` and is read through its `IUserHealthContextReader`
 * port. Reaching into `userAllergy` / `userCondition` / `userCurrentMedicine`
 * from `reports` would make this context a second writer-shaped owner of
 * another context's tables — invisible to the dependency rules, since a Prisma
 * call is not an import, and therefore exactly the kind of drift those rules
 * cannot catch.
 */
export interface ClinicSummarySources {
  /**
   * The display name shown on the summary header, or `null` when unset.
   * De-identified output depends on this being the nickname only.
   */
  findDisplayName(userId: string): Promise<string | null>;
}
