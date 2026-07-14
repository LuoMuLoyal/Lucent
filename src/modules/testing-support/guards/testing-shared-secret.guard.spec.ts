import type { ConfigService } from '@nestjs/config';
import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { TestingSharedSecretGuard } from './testing-shared-secret.guard';

describe('TestingSharedSecretGuard', () => {
  let configService: vi.Mocked<ConfigService>;
  let guard: TestingSharedSecretGuard;

  beforeEach(() => {
    configService = {
      get: vi.fn(),
    } as unknown as vi.Mocked<ConfigService>;
    guard = new TestingSharedSecretGuard(configService);
  });

  function buildContext(
    headers: Record<string, string | string[] | undefined>,
  ): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ headers }),
      }),
    } as unknown as ExecutionContext;
  }

  it('throws when TESTING_SHARED_SECRET is not configured', () => {
    configService.get.mockReturnValue(undefined);

    expect(() => guard.canActivate(buildContext({}))).toThrow(
      ForbiddenException,
    );
  });

  it('throws when TESTING_SHARED_SECRET is empty string', () => {
    configService.get.mockReturnValue('');

    expect(() => guard.canActivate(buildContext({}))).toThrow(
      ForbiddenException,
    );
  });

  it('throws when x-testing-secret header is missing', () => {
    configService.get.mockReturnValue('super-secret');

    expect(() => guard.canActivate(buildContext({}))).toThrow(
      ForbiddenException,
    );
  });

  it('throws when x-testing-secret header is empty', () => {
    configService.get.mockReturnValue('super-secret');

    expect(() =>
      guard.canActivate(buildContext({ 'x-testing-secret': '' })),
    ).toThrow(ForbiddenException);
  });

  it('throws when x-testing-secret header is an array', () => {
    configService.get.mockReturnValue('super-secret');

    expect(() =>
      guard.canActivate(buildContext({ 'x-testing-secret': ['a', 'b'] })),
    ).toThrow(ForbiddenException);
  });

  it('throws when secret does not match', () => {
    configService.get.mockReturnValue('super-secret');

    expect(() =>
      guard.canActivate(buildContext({ 'x-testing-secret': 'wrong-secret' })),
    ).toThrow(ForbiddenException);
  });

  it('returns true when secret matches', () => {
    configService.get.mockReturnValue('super-secret');

    const result = guard.canActivate(
      buildContext({ 'x-testing-secret': 'super-secret' }),
    );

    expect(result).toBe(true);
  });

  it('is case-sensitive', () => {
    configService.get.mockReturnValue('SuperSecret');

    expect(() =>
      guard.canActivate(buildContext({ 'x-testing-secret': 'supersecret' })),
    ).toThrow(ForbiddenException);
  });
});
