import { safeCompare } from './crypto.utils';

describe('safeCompare', () => {
  it('returns true for identical strings', () => {
    expect(safeCompare('hello', 'hello')).toBe(true);
  });

  it('returns false for different strings of same length', () => {
    expect(safeCompare('hello', 'world')).toBe(false);
  });

  it('returns false for different strings of different lengths', () => {
    expect(safeCompare('short', 'much-longer-string')).toBe(false);
  });

  it('returns true for empty strings', () => {
    expect(safeCompare('', '')).toBe(true);
  });

  it('returns false when one string is empty and the other is not', () => {
    expect(safeCompare('', 'a')).toBe(false);
    expect(safeCompare('a', '')).toBe(false);
  });

  it('returns true for unicode strings', () => {
    expect(safeCompare('你好世界', '你好世界')).toBe(true);
  });

  it('returns false for similar but not identical unicode strings', () => {
    expect(safeCompare('你好世界', '你好世界!')).toBe(false);
  });

  it('handles long strings correctly', () => {
    const long = 'a'.repeat(10000);
    expect(safeCompare(long, long)).toBe(true);
    expect(safeCompare(long, 'b'.repeat(10000))).toBe(false);
  });
});
