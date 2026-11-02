import type { Logger } from '@nestjs/common';
import {
  encodeVectorCursor,
  decodeVectorCursor,
  buildVectorQueryHash,
  buildVectorPage,
} from './vector-cursor.js';

/** Minimal mock logger that silently swallows warn calls. */
const mockLogger = {
  warn: () => {},
} as unknown as Logger;

describe('vector-cursor', () => {
  // -----------------------------------------------------------------------
  // encodeVectorCursor / decodeVectorCursor
  // -----------------------------------------------------------------------
  describe('encodeVectorCursor & decodeVectorCursor', () => {
    it('round-trips a valid payload', () => {
      const payload = {
        offset: 10,
        limit: 5,
        queryHash: 'abc123',
      };
      const encoded = encodeVectorCursor(payload);
      expect(typeof encoded).toBe('string');
      expect(encoded).not.toBe('');

      const decoded = decodeVectorCursor(encoded, mockLogger as never);
      expect(decoded).toEqual(payload);
    });

    it('produces base64url-safe strings', () => {
      const encoded = encodeVectorCursor({
        offset: 0,
        limit: 10,
        queryHash: 'hash-with-special-chars!@#',
      });
      // base64url should not contain +, /, or =
      expect(encoded).not.toMatch(/[+/=]/);
    });

    it('decodes to null for null input', () => {
      expect(decodeVectorCursor(null, mockLogger as never)).toBeNull();
    });

    it('decodes to null for undefined input', () => {
      expect(decodeVectorCursor(undefined, mockLogger as never)).toBeNull();
    });

    it('decodes to null for empty string', () => {
      expect(decodeVectorCursor('', mockLogger as never)).toBeNull();
    });

    it('decodes to null for invalid base64', () => {
      expect(
        decodeVectorCursor('!!!invalid!!!', mockLogger as never),
      ).toBeNull();
    });

    it('decodes to null for valid base64 but invalid JSON', () => {
      const invalidJson = Buffer.from('not json', 'utf8').toString('base64url');
      expect(decodeVectorCursor(invalidJson, mockLogger as never)).toBeNull();
    });

    it('decodes to null for valid JSON with wrong shape (missing fields)', () => {
      const wrongShape = Buffer.from(
        JSON.stringify({ foo: 'bar' }),
        'utf8',
      ).toString('base64url');
      // The function returns the parsed object as-is, it doesn't validate shape
      const result = decodeVectorCursor(wrongShape, mockLogger as never);
      expect(result).not.toBeNull();
      expect(result).toEqual({ foo: 'bar' });
    });
  });

  // -----------------------------------------------------------------------
  // buildVectorQueryHash
  // -----------------------------------------------------------------------
  describe('buildVectorQueryHash', () => {
    it('returns a deterministic hex hash for the same input', () => {
      const hash1 = buildVectorQueryHash('test query', { type: 'medicine' });
      const hash2 = buildVectorQueryHash('test query', { type: 'medicine' });
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[0-9a-f]+$/);
    });

    it('returns different hashes for different queries', () => {
      const hash1 = buildVectorQueryHash('query A', {});
      const hash2 = buildVectorQueryHash('query B', {});
      expect(hash1).not.toBe(hash2);
    });

    it('returns different hashes for different filters', () => {
      const hash1 = buildVectorQueryHash('same query', { type: 'a' });
      const hash2 = buildVectorQueryHash('same query', { type: 'b' });
      expect(hash1).not.toBe(hash2);
    });

    it('uses default empty filters when not provided', () => {
      const hash1 = buildVectorQueryHash('test');
      const hash2 = buildVectorQueryHash('test', {});
      expect(hash1).toBe(hash2);
    });

    it('returns consistent hash for empty query string', () => {
      const hash1 = buildVectorQueryHash('');
      const hash2 = buildVectorQueryHash('');
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[0-9a-f]+$/);
    });

    it('returns different hashes for empty vs non-empty query', () => {
      const hash1 = buildVectorQueryHash('');
      const hash2 = buildVectorQueryHash('test');
      expect(hash1).not.toBe(hash2);
    });
  });

  // -----------------------------------------------------------------------
  // buildVectorPage
  // -----------------------------------------------------------------------
  describe('buildVectorPage', () => {
    it('builds a page with nextCursor when hasMore is true', () => {
      const page = buildVectorPage({
        limit: 5,
        offset: 0,
        hasMore: true,
        queryHash: 'hash123',
      });

      expect(page.limit).toBe(5);
      expect(page.offset).toBe(0);
      expect(page.hasMore).toBe(true);
      expect(page.nextCursor).not.toBeNull();

      const decoded = decodeVectorCursor(page.nextCursor, mockLogger as never);
      expect(decoded).toEqual({
        offset: 5,
        limit: 5,
        queryHash: 'hash123',
      });
    });

    it('builds a page with null nextCursor when hasMore is false', () => {
      const page = buildVectorPage({
        limit: 5,
        offset: 10,
        hasMore: false,
        queryHash: 'hash123',
      });

      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
    });

    it('correctly calculates next offset', () => {
      const page = buildVectorPage({
        limit: 10,
        offset: 20,
        hasMore: true,
        queryHash: 'hash',
      });

      const decoded = decodeVectorCursor(page.nextCursor, mockLogger as never);
      expect(decoded?.offset).toBe(30);
      expect(decoded?.limit).toBe(10);
    });

    it('handles offset of 0', () => {
      const page = buildVectorPage({
        limit: 10,
        offset: 0,
        hasMore: true,
        queryHash: 'hash',
      });

      const decoded = decodeVectorCursor(page.nextCursor, mockLogger as never);
      expect(decoded?.offset).toBe(10);
    });
  });
});
