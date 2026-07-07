import { extractErrorInfo } from './error-info.utils';

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
});
