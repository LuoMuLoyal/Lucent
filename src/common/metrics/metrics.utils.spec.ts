import { normalizeRoute, shouldSkip } from './metrics.utils';

describe('metrics.utils', () => {
  // ── normalizeRoute ──────────────────────────────────────────────────────

  describe('normalizeRoute', () => {
    it('returns the path as-is when no IDs are present', () => {
      expect(normalizeRoute('/api/v1/medicines')).toBe('/api/v1/medicines');
    });

    it('strips query string before normalising', () => {
      expect(normalizeRoute('/api/v1/medicines?q=aspirin&page=2')).toBe(
        '/api/v1/medicines',
      );
    });

    it('replaces a single numeric ID segment with :id', () => {
      expect(normalizeRoute('/api/v1/medicines/42')).toBe(
        '/api/v1/medicines/:id',
      );
    });

    it('replaces multiple numeric ID segments', () => {
      expect(normalizeRoute('/api/v1/users/10/reminders/20')).toBe(
        '/api/v1/users/:id/reminders/:id',
      );
    });

    it('replaces a UUID with :id', () => {
      const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      expect(normalizeRoute(`/api/v1/records/${uuid}`)).toBe(
        '/api/v1/records/:id',
      );
    });

    it('replaces multiple UUIDs', () => {
      const uuid1 = '11111111-2222-3333-4444-555555555555';
      const uuid2 = '66666666-7777-8888-9999-aaaaaaaaaaaa';
      expect(normalizeRoute(`/api/v1/users/${uuid1}/records/${uuid2}`)).toBe(
        '/api/v1/users/:id/records/:id',
      );
    });

    it('handles mixed numeric and UUID IDs', () => {
      const uuid = 'deadbeef-cafe-babe-1234-567890abcdef';
      expect(normalizeRoute(`/api/v1/users/5/records/${uuid}/items/3`)).toBe(
        '/api/v1/users/:id/records/:id/items/:id',
      );
    });

    it('returns empty string for empty input', () => {
      expect(normalizeRoute('')).toBe('');
    });

    it('does not replace numeric substrings inside path segments', () => {
      // Only standalone /<digits>/ or /<digits>$ are replaced
      expect(normalizeRoute('/api/v1/medicines/page10')).toBe(
        '/api/v1/medicines/page10',
      );
    });
  });

  // ── shouldSkip ──────────────────────────────────────────────────────────

  describe('shouldSkip', () => {
    it('returns true for /metrics', () => {
      expect(shouldSkip('/metrics')).toBe(true);
    });

    it('returns true for /api/v1/health', () => {
      expect(shouldSkip('/api/v1/health')).toBe(true);
    });

    it('returns true for /api/v1/healthz', () => {
      expect(shouldSkip('/api/v1/healthz')).toBe(true);
    });

    it('returns true for /api/v1/health with query params', () => {
      expect(shouldSkip('/api/v1/health?check=db')).toBe(true);
    });

    it('returns false for normal API paths', () => {
      expect(shouldSkip('/api/v1/medicines')).toBe(false);
    });

    it('returns false for root path', () => {
      expect(shouldSkip('/')).toBe(false);
    });

    it('returns false for admin paths', () => {
      expect(shouldSkip('/admin')).toBe(false);
    });
  });
});
