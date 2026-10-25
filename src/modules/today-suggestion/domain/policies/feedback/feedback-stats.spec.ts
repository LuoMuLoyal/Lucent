import { computeRuleStats } from './feedback-stats.js';
import type { FeedbackRuleRow } from './feedback-stats.js';

/** Builds a feedback row for rule aggregation tests. */
function buildRow(
  ruleId: string,
  feedback: string,
  suggestionId = `sug-${Math.random()}`,
): FeedbackRuleRow {
  return {
    suggestionId,
    feedback,
    appliedAt: new Date('2026-07-10T08:00:00.000Z'),
    ruleId,
  };
}

describe('computeRuleStats', () => {
  it('returns an empty map when nothing was loaded', () => {
    expect(computeRuleStats([], ['rule-a']).size).toBe(0);
  });

  it('returns an empty map when no rules are requested', () => {
    const rows = [buildRow('rule-a', 'accepted')];

    expect(computeRuleStats(rows, []).size).toBe(0);
  });

  it('counts each feedback kind per rule', () => {
    const rows = [
      buildRow('rule-a', 'accepted'),
      buildRow('rule-a', 'later'),
      buildRow('rule-a', 'not_applicable'),
      buildRow('rule-a', 'suppress'),
    ];

    const stats = computeRuleStats(rows, ['rule-a']).get('rule-a');

    expect(stats).toBeDefined();
    expect(stats!.acceptedCount).toBe(1);
    expect(stats!.laterCount).toBe(1);
    expect(stats!.notApplicableCount).toBe(1);
    expect(stats!.suppressCount).toBe(1);
    expect(stats!.totalFeedback).toBe(4);
  });

  it('drops rules that were not requested', () => {
    const rows = [
      buildRow('rule-a', 'accepted'),
      buildRow('rule-b', 'accepted'),
    ];

    const result = computeRuleStats(rows, ['rule-a']);

    expect(result.has('rule-b')).toBe(false);
    expect(result.get('rule-a')!.totalFeedback).toBe(1);
  });

  it('keeps rules independent', () => {
    const rows = [
      buildRow('rule-a', 'accepted'),
      buildRow('rule-b', 'suppress'),
      buildRow('rule-b', 'suppress'),
    ];

    const result = computeRuleStats(rows, ['rule-a', 'rule-b']);

    expect(result.get('rule-a')!.acceptRatio).toBe(1);
    expect(result.get('rule-b')!.suppressRatio).toBe(1);
  });

  it('ignores feedback kinds outside the four that matter', () => {
    const rows = [
      buildRow('rule-a', 'accepted'),
      buildRow('rule-a', 'unknown_feedback'),
    ];

    const stats = computeRuleStats(rows, ['rule-a']).get('rule-a');

    expect(stats!.totalFeedback).toBe(1);
    expect(stats!.acceptedCount).toBe(1);
  });
});
