/**
 * Pure unit tests for the `Proposal` aggregate — the four rules the confirm path
 * exists to enforce. No Nest container, no Prisma, no LLM mocks.
 */
import {
  decide,
  isExpired,
  isReviewBoundTo,
  selectConfirmableProposals,
  targetRecordIdOf,
  type ProposalEntry,
  type ProposalReview,
} from './proposal.js';

const NOW = new Date('2026-10-25T08:00:00.000Z');
const LATER = new Date('2026-10-25T09:00:00.000Z');

function entry(overrides: Partial<ProposalEntry> = {}): ProposalEntry {
  return {
    id: 'p1',
    ownerUserId: 'user-1',
    targetRecordId: 'record-1',
    expiresAt: LATER,
    status: 'pending',
    payload: { type: 'update_daily_record', recordId: 'record-1', draft: { value: '300' } },
    ...overrides,
  };
}

function review(overrides: Partial<ProposalReview> = {}): ProposalReview {
  return {
    conversationId: 'conv-1',
    ownerUserId: 'user-1',
    proposals: [entry()],
    status: 'pending',
    ...overrides,
  };
}

describe('Proposal', () => {
  describe('rule 1 — only a pending review may be confirmed', () => {
    it('refuses when the thread is not suspended', () => {
      expect(
        selectConfirmableProposals({ review: null, requestedIds: ['p1'], userId: 'user-1', at: NOW }),
      ).toEqual({ rule: 'no_pending_review' });
    });

    it('refuses a review that was already decided', () => {
      expect(
        selectConfirmableProposals({
          review: review({ status: 'approved' }),
          requestedIds: ['p1'],
          userId: 'user-1',
          at: NOW,
        }),
      ).toEqual({ rule: 'review_already_decided' });
    });

    it('refuses an id that is not in this review', () => {
      expect(
        selectConfirmableProposals({
          review: review(),
          requestedIds: ['other'],
          userId: 'user-1',
          at: NOW,
        }),
      ).toEqual({ rule: 'proposal_not_found' });
    });

    it('treats confirming nothing as a no-op selection, not an error', () => {
      expect(
        selectConfirmableProposals({ review: review(), requestedIds: [], userId: 'user-1', at: NOW }),
      ).toEqual({ proposals: [] });
    });
  });

  describe('rule 2 — confirmation happens exactly once', () => {
    it('moves a pending review to approved', () => {
      const result = decide({ review: review(), decision: 'approved', proposalIds: ['p1'], at: NOW });
      if (!('next' in result)) throw new Error('expected a decision');
      expect(result.next.status).toBe('approved');
      expect(result.next.proposals[0]?.status).toBe('approved');
    });

    it('a second confirm of the same review is refused', () => {
      const first = decide({ review: review(), decision: 'approved', proposalIds: ['p1'], at: NOW });
      if (!('next' in first)) throw new Error('expected a decision');
      expect(
        decide({ review: first.next, decision: 'approved', proposalIds: ['p1'], at: NOW }),
      ).toEqual({ rule: 'review_already_decided' });
    });

    it('refuses a proposal that was already decided inside a pending review', () => {
      expect(
        selectConfirmableProposals({
          review: review({ proposals: [entry({ status: 'approved' })] }),
          requestedIds: ['p1'],
          userId: 'user-1',
          at: NOW,
        }),
      ).toEqual({ rule: 'review_already_decided' });
    });

    it('does not silently reject the proposals the user did not name', () => {
      const result = decide({
        review: review({
          proposals: [entry({ id: 'p1' }), entry({ id: 'p2', targetRecordId: 'record-2' })],
        }),
        decision: 'approved',
        proposalIds: ['p1'],
        at: NOW,
      });
      if (!('next' in result)) throw new Error('expected a decision');
      expect(result.next.proposals[0]?.status).toBe('approved');
      expect(result.next.proposals[1]?.status).toBe('pending');
    });
  });

  describe('rule 3 — an expired proposal cannot be confirmed', () => {
    it('treats the expiry instant itself as expired', () => {
      expect(isExpired(entry({ expiresAt: NOW }), NOW)).toBe(true);
    });

    it('rejects the whole batch when one member is stale', () => {
      expect(
        selectConfirmableProposals({
          review: review({
            proposals: [
              entry({ id: 'fresh' }),
              entry({ id: 'stale', expiresAt: new Date(NOW.getTime() - 1) }),
            ],
          }),
          requestedIds: ['fresh', 'stale'],
          userId: 'user-1',
          at: NOW,
        }),
      ).toEqual({ rule: 'proposal_expired' });
    });

    it('a stale proposal cannot ride in on a sibling still fresh', () => {
      expect(
        decide({
          review: review({
            proposals: [entry({ id: 'stale', expiresAt: new Date(NOW.getTime() - 1) })],
          }),
          decision: 'approved',
          proposalIds: ['stale'],
          at: NOW,
        }),
      ).toEqual({ rule: 'proposal_expired' });
    });
  });

  describe('rule 4 — the target belongs to the current user', () => {
    it('refuses a proposal drafted for another user', () => {
      expect(
        selectConfirmableProposals({
          review: review({ proposals: [entry({ ownerUserId: 'user-2' })] }),
          requestedIds: ['p1'],
          userId: 'user-1',
          at: NOW,
        }),
      ).toEqual({ rule: 'proposal_not_owned' });
    });

    it('refuses when the review itself belongs to another user', () => {
      expect(
        isReviewBoundTo({
          review: review({ ownerUserId: 'user-2', proposals: [] }),
          userId: 'user-1',
          conversationId: 'conv-1',
        }),
      ).toBe(false);
    });

    it('refuses when the review belongs to another conversation', () => {
      expect(
        isReviewBoundTo({
          review: review({ conversationId: 'conv-2', proposals: [] }),
          userId: 'user-1',
          conversationId: 'conv-1',
        }),
      ).toBe(false);
    });

    it('binds a matching review', () => {
      expect(
        isReviewBoundTo({ review: review(), userId: 'user-1', conversationId: 'conv-1' }),
      ).toBe(true);
    });

    it('a create payload names no record, so it cannot reach another row', () => {
      expect(
        targetRecordIdOf({
          type: 'create_daily_record',
          draft: {
            kind: 'water',
            occurredAt: '2026-10-25',
            title: null,
            value: '300',
            unit: 'ml',
            note: null,
            payload: null,
          },
        }),
      ).toBeNull();
    });

    it('an update/delete payload names the record it targets', () => {
      expect(targetRecordIdOf({ type: 'delete_daily_record', recordId: 'record-9' })).toBe(
        'record-9',
      );
    });
  });

  it('rejecting resolves the review without naming proposals', () => {
    const result = decide({ review: review(), decision: 'rejected', proposalIds: ['p1'], at: NOW });
    if (!('next' in result)) throw new Error('expected a decision');
    expect(result.next.status).toBe('rejected');
    expect(result.next.proposals[0]?.status).toBe('pending');
  });
});
