/**
 * `Proposal` aggregate (ADR-0024 §4) — the human-in-the-loop write boundary.
 *
 * A proposal is what the assistant hands the user instead of writing: a target, a
 * payload, an expiry and a status. The confirm path is the only place in the
 * assistant context that writes customer data, so all of its rules live here, as
 * pure decisions, with no HTTP, no Prisma and no LLM in sight:
 *
 * 1. **Only a `pending` review may be confirmed.** A thread that is not suspended
 *    at the review point has nothing to approve. Confirming twice is the classic
 *    double-tap: the first click writes, the second must be refused rather than
 *    write again.
 *
 * 2. **Confirmation happens exactly once.** `pending` -> `approved`/`rejected` is
 *    a one-way transition.
 *
 * 3. **An expired proposal cannot be confirmed.** Expiry is evaluated **per
 *    proposal**, not per batch: a stale proposal may not ride in on a sibling that
 *    is still fresh. One expired member rejects the whole batch — partially
 *    applying a batch the user approved as a unit is the "confirmed but not
 *    written" state the audit trail exists to make impossible.
 *
 * 4. **A proposal's target belongs to the current user.** The approved write is
 *    attributed to the authenticated user and never to an id carried in the
 *    proposal.
 *
 * Layer purity (ADR-0024 rule D1): no imports outside `domain/`.
 */

import type { ProposalPayload } from './proposed-action.js';

export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export type ProposalDecision = 'approved' | 'rejected';

/** One proposal as the review step sees it. */
export interface ProposalEntry {
  /** Ephemeral id chosen when the proposal was drafted; `confirm` names these. */
  id: string;
  /** The user this proposal was drafted for (NOT taken from the client). */
  ownerUserId: string;
  /** Record the payload targets, when the payload names one. */
  targetRecordId: string | null;
  /** Instant after which the proposal may no longer be confirmed. */
  expiresAt: Date;
  status: ProposalStatus;
  payload: ProposalPayload;
}

/** The review a persisted thread is suspended at. */
export interface ProposalReview {
  conversationId: string;
  ownerUserId: string;
  /** Proposals awaiting the user's decision, in the order they were drafted. */
  proposals: readonly ProposalEntry[];
  status: 'pending' | ProposalDecision;
}

/**
 * Why a confirm was refused.
 *
 * Each value maps onto one registered `DomainFailure` code at the application
 * boundary; the vocabulary is deliberately coarse so the client cannot use it to
 * probe which proposal ids exist.
 */
export type ProposalRule =
  | 'no_pending_review'
  | 'review_already_decided'
  | 'proposal_not_found'
  | 'proposal_expired'
  | 'proposal_not_owned';

/** True once the clock is at or past the proposal's expiry. */
export function isExpired(proposal: ProposalEntry, at: Date): boolean {
  return proposal.expiresAt.getTime() <= at.getTime();
}

/**
 * Rules 1, 3 and 4: which proposals may be written for this decision.
 *
 * `requestedIds` is what the client named. Rules applied in a deliberate order:
 * the review must be pending; the named proposals must exist **within this
 * review**; none may be expired; each must belong to the authenticated user.
 *
 * An empty `requestedIds` means "the user confirmed the review without naming
 * proposals", which approves nothing but still resumes the thread.
 */
export function selectConfirmableProposals(input: {
  review: ProposalReview | null;
  requestedIds: readonly string[];
  userId: string;
  at: Date;
}): { rule: ProposalRule } | { proposals: ProposalEntry[] } {
  const { review, requestedIds, userId, at } = input;
  if (review == null) {
    return { rule: 'no_pending_review' };
  }
  if (review.status !== 'pending') {
    return { rule: 'review_already_decided' };
  }
  if (requestedIds.length === 0) {
    return { proposals: [] };
  }

  const byId = new Map(review.proposals.map((proposal) => [proposal.id, proposal]));
  const selected: ProposalEntry[] = [];
  for (const id of requestedIds) {
    const proposal = byId.get(id);
    if (proposal == null) {
      return { rule: 'proposal_not_found' };
    }
    if (proposal.status !== 'pending') {
      // Rule 2: a proposal already decided in this review cannot be re-written.
      return { rule: 'review_already_decided' };
    }
    if (proposal.ownerUserId !== userId || review.ownerUserId !== userId) {
      return { rule: 'proposal_not_owned' };
    }
    if (isExpired(proposal, at)) {
      return { rule: 'proposal_expired' };
    }
    selected.push(proposal);
  }
  return { proposals: selected };
}

/**
 * Rule 2: the single allowed transition.
 *
 * Returns the next review state, or the rule that refused it. The review is
 * decided as a unit, and a proposal the user did not name keeps its recorded
 * status rather than being silently rejected (marking it rejected would claim a
 * decision the user did not make).
 */
export function decide(input: {
  review: ProposalReview;
  decision: ProposalDecision;
  proposalIds: readonly string[];
  at: Date;
}): { next: ProposalReview } | { rule: ProposalRule } {
  const selection = selectConfirmableProposals({
    review: input.review,
    requestedIds: input.decision === 'approved' ? input.proposalIds : [],
    userId: input.review.ownerUserId,
    at: input.at,
  });
  if ('rule' in selection) {
    return selection;
  }

  const decided = new Set(selection.proposals.map((proposal) => proposal.id));
  return {
    next: {
      ...input.review,
      status: input.decision,
      proposals: input.review.proposals.map((proposal) => ({
        ...proposal,
        status: decided.has(proposal.id) ? input.decision : proposal.status,
      })),
    },
  };
}

/**
 * Rule 4, payload half: the record id a payload names, if any.
 *
 * The create case names none (there is no record yet), so it yields `null` and
 * cannot be used to reach another user's row.
 */
export function targetRecordIdOf(payload: ProposalPayload): string | null {
  switch (payload.type) {
    case 'create_daily_record':
      return null;
    case 'update_daily_record':
    case 'delete_daily_record':
      return payload.recordId;
    case 'update_user_settings':
      return null;
  }
}

/**
 * Rule 4, honest-name check: proposal ids are ephemeral and client-supplied on
 * confirm, so the review they are resolved against must be the one bound to this
 * conversation *and* this user.
 */
export function isReviewBoundTo(input: {
  review: ProposalReview;
  userId: string;
  conversationId: string;
}): boolean {
  return (
    input.review.ownerUserId === input.userId &&
    input.review.conversationId === input.conversationId
  );
}
