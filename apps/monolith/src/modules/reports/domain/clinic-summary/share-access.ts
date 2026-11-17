/**
 * Share accessibility — the one real rule of the clinic-summary share.
 *
 * A share is accessible iff it has not been revoked **and** has not expired.
 * This is the entire domain content of the share: there is no stored `status`
 * column and no closed state set, so no aggregate is warranted (see the port
 * comment in `application/ports/clinic-summary.ts`).
 *
 * It still belongs in `domain/` rather than being inlined per call site: the
 * read path (`findAccessibleByTokenHash`), the atomic access write and the
 * revoke guard all ask the same question, and three independent spellings of
 * "still valid" is how they drift apart. Time is a parameter so the boundary
 * is testable exactly.
 */

/** The slice of a share row that decides accessibility. */
export interface ShareAccessibility {
  revokedAt: Date | null;
  expiresAt: Date;
}

/**
 * True when the share may be read at `at`.
 *
 * The expiry comparison is strict (`>`) on purpose: a share expiring exactly at
 * `at` is already closed, matching the SQL predicate the port implementations
 * use (`expiresAt: { gt: at }`). Changing one without the other silently
 * reopens a one-instant window, so the strictness is pinned by a spec.
 */
export function isShareAccessible(
  share: ShareAccessibility,
  at: Date,
): boolean {
  return share.revokedAt === null && share.expiresAt.getTime() > at.getTime();
}
