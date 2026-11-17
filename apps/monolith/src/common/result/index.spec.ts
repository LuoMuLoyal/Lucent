import {
  errAsync,
  ok,
  okAsync,
  type Result,
  type ResultAsync,
} from './index.js';

describe('common/result entry point', () => {
  it('exposes synchronous Result constructors', () => {
    const result: Result<number, string> = ok(1);

    expect(result.isOk()).toBe(true);
    expect(result.unwrapOr(0)).toBe(1);
  });

  it('exposes asynchronous Result constructors', async () => {
    const success: ResultAsync<number, string> = okAsync(1);
    const failure: ResultAsync<number, string> = errAsync('failed');

    await expect(
      success.match(
        (value) => value,
        () => 0,
      ),
    ).resolves.toBe(1);
    await expect(
      failure.match(
        () => 0,
        (error) => error,
      ),
    ).resolves.toBe('failed');
  });
});
