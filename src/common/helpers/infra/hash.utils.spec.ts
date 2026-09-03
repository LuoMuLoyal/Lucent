import { makeShortHash } from './hash.utils.js';

describe('makeShortHash', () => {
  it('returns a 16-char hex string by default', () => {
    const result = makeShortHash('test-value');
    expect(result).toMatch(/^[0-9a-f]{16}$/);
  });

  it('produces consistent output for the same input', () => {
    expect(makeShortHash('hello')).toBe(makeShortHash('hello'));
  });

  it('produces different output for different input', () => {
    expect(makeShortHash('hello')).not.toBe(makeShortHash('world'));
  });

  it('respects custom length', () => {
    const result = makeShortHash('test-value', 8);
    expect(result).toMatch(/^[0-9a-f]{8}$/);
  });

  it('handles empty string input', () => {
    const result = makeShortHash('');
    expect(result).toMatch(/^[0-9a-f]{16}$/);
  });

  it('handles unicode input', () => {
    const result = makeShortHash('你好世界');
    expect(result).toMatch(/^[0-9a-f]{16}$/);
  });
});
