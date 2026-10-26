/**
 * Pure unit tests for the `Summary` aggregate: the version fence and scope
 * addressability.
 */
import {
  isAddressableScope,
  mayReplaceSummary,
  scopeKeyOf,
  type SummaryScope,
} from './summary.js';

describe('Summary', () => {
  describe('version fence', () => {
    it('allows the first write', () => {
      expect(
        mayReplaceSummary({
          storedSourceVersion: null,
          incomingSourceVersion: null,
        }),
      ).toBe(true);
    });

    it('allows a strictly newer version', () => {
      expect(
        mayReplaceSummary({ storedSourceVersion: 3, incomingSourceVersion: 4 }),
      ).toBe(true);
    });

    it('refuses an equal version', () => {
      expect(
        mayReplaceSummary({ storedSourceVersion: 3, incomingSourceVersion: 3 }),
      ).toBe(false);
    });

    it('refuses an older version — a slow generation cannot overwrite a newer summary', () => {
      expect(
        mayReplaceSummary({ storedSourceVersion: 5, incomingSourceVersion: 4 }),
      ).toBe(false);
    });

    it('refuses an unversioned write over a versioned row', () => {
      expect(
        mayReplaceSummary({
          storedSourceVersion: 2,
          incomingSourceVersion: null,
        }),
      ).toBe(false);
    });

    it('allows a write over an unversioned legacy row', () => {
      expect(
        mayReplaceSummary({
          storedSourceVersion: null,
          incomingSourceVersion: 1,
        }),
      ).toBe(true);
    });
  });

  describe('scope', () => {
    it('a today summary needs a date', () => {
      expect(isAddressableScope({ kind: 'today', date: null })).toBe(false);
      expect(isAddressableScope({ kind: 'today', date: '2026-10-25' })).toBe(
        true,
      );
    });

    it('a fixed report range is addressable by its key alone', () => {
      expect(
        isAddressableScope({ kind: 'report', rangeKey: 'last_7_days' }),
      ).toBe(true);
    });

    it('a custom range needs both bounds', () => {
      expect(
        isAddressableScope({
          kind: 'report',
          rangeKey: 'custom',
          startDate: '2026-10-01',
        }),
      ).toBe(false);
      expect(
        isAddressableScope({
          kind: 'report',
          rangeKey: 'custom',
          startDate: '2026-10-01',
          endDate: '2026-10-07',
        }),
      ).toBe(true);
    });

    it('distinguishes every addressable scope', () => {
      const scopes: SummaryScope[] = [
        { kind: 'today', date: '2026-10-25' },
        { kind: 'report', rangeKey: 'last_7_days' },
        { kind: 'report', rangeKey: 'last_30_days' },
        { kind: 'report', rangeKey: 'custom', startDate: 'a', endDate: 'b' },
      ];
      expect(new Set(scopes.map((scope) => scopeKeyOf(scope))).size).toBe(
        scopes.length,
      );
    });

    it('returns no key for an unaddressable scope', () => {
      expect(scopeKeyOf({ kind: 'today', date: '' })).toBeNull();
    });
  });
});
