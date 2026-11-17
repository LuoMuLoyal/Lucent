import { extractErrorInfo } from './error-info.utils.js';

describe('extractErrorInfo', () => {
  it('extracts message and stack from an Error instance', () => {
    const error = new Error('something went wrong');
    const info = extractErrorInfo(error);

    expect(info.message).toBe('something went wrong');
    expect(info.stack).toBe(error.stack);
  });

  it('extracts message from a subclass of Error', () => {
    const error = new TypeError('bad type');
    const info = extractErrorInfo(error);

    expect(info.message).toBe('bad type');
    expect(info.stack).toBe(error.stack);
  });

  it('stringifies non-Error values', () => {
    expect(extractErrorInfo('plain string').message).toBe('plain string');
    expect(extractErrorInfo(42).message).toBe('42');
    expect(extractErrorInfo(null).message).toBe('null');
    expect(extractErrorInfo(undefined).message).toBe('undefined');
    expect(extractErrorInfo({ custom: true }).message).toBe('[object Object]');
  });

  it('does not include a stack for non-Error values', () => {
    const info = extractErrorInfo('plain string');
    expect(info.stack).toBeUndefined();
  });

  it('handles Error with empty message', () => {
    const error = new Error('');
    const info = extractErrorInfo(error);
    expect(info.message).toBe('');
    expect(info.stack).toBe(error.stack);
  });

  it('handles Error subclass with custom properties', () => {
    class CustomError extends Error {
      constructor(
        message: string,
        public readonly code: number,
      ) {
        super(message);
        this.name = 'CustomError';
      }
    }
    const error = new CustomError('custom failure', 42);
    const info = extractErrorInfo(error);
    expect(info.message).toBe('custom failure');
    expect(info.stack).toBe(error.stack);
  });

  it('handles boolean values', () => {
    expect(extractErrorInfo(true).message).toBe('true');
    expect(extractErrorInfo(false).message).toBe('false');
  });

  it('handles numeric values including special numbers', () => {
    expect(extractErrorInfo(0).message).toBe('0');
    expect(extractErrorInfo(-1).message).toBe('-1');
    expect(extractErrorInfo(NaN).message).toBe('NaN');
    expect(extractErrorInfo(Infinity).message).toBe('Infinity');
  });

  it('handles arrays', () => {
    expect(extractErrorInfo([1, 2, 3]).message).toBe('1,2,3');
  });
});
