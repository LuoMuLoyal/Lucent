import { Test, type TestingModule } from '@nestjs/testing';
import { PasswordReauthService } from './password-reauth.service';
import { AuthBetterAuthAdapter } from '../../adapters/better-auth.adapter';
import { AuthRateLimitService } from './rate-limit.service';
import {
  createDomainFailure,
  errAsync,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result';

function collectResult<T>(
  result: ResultAsync<T, DomainFailure>,
): Promise<{ ok: true; value: T } | { ok: false; error: DomainFailure }> {
  return result.match(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
}

describe('PasswordReauthService', () => {
  let service: PasswordReauthService;
  let adapter: vi.Mocked<AuthBetterAuthAdapter>;
  let rateLimitService: vi.Mocked<AuthRateLimitService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PasswordReauthService,
        {
          provide: AuthBetterAuthAdapter,
          useValue: {
            verifyPasswordForUser: vi.fn().mockReturnValue(okAsync(true)),
          },
        },
        {
          provide: AuthRateLimitService,
          useValue: {
            checkReauthRateLimit: vi.fn().mockReturnValue(okAsync(undefined)),
            recordReauthFailure: vi.fn().mockReturnValue(okAsync(undefined)),
            clearReauthFailures: vi.fn().mockReturnValue(okAsync(undefined)),
          },
        },
      ],
    }).compile();

    service = module.get(PasswordReauthService);
    adapter = module.get(AuthBetterAuthAdapter);
    rateLimitService = module.get(AuthRateLimitService);
  });

  it('returns ok when password is correct', async () => {
    const outcome = await collectResult(
      service.verify('user-1', 'Passw0rd123'),
    );

    expect(rateLimitService.checkReauthRateLimit).toHaveBeenCalledWith(
      'user-1',
    );
    expect(adapter.verifyPasswordForUser).toHaveBeenCalledWith(
      'user-1',
      'Passw0rd123',
    );
    expect(rateLimitService.clearReauthFailures).toHaveBeenCalledWith('user-1');
    expect(outcome).toEqual({ ok: true, value: undefined });
  });

  it('returns AUTH_WRONG_PASSWORD and records a failure when password is wrong', async () => {
    adapter.verifyPasswordForUser.mockReturnValue(okAsync(false));

    const outcome = await collectResult(service.verify('user-1', 'WrongPass'));

    expect(outcome).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'AUTH_WRONG_PASSWORD' }),
    });
    expect(rateLimitService.recordReauthFailure).toHaveBeenCalledWith('user-1');
    expect(rateLimitService.clearReauthFailures).not.toHaveBeenCalled();
  });

  it('propagates AUTH_PASSWORD_NOT_SET from the adapter', async () => {
    const failure = createDomainFailure({
      kind: 'authentication',
      code: 'AUTH_PASSWORD_NOT_SET',
    });
    adapter.verifyPasswordForUser.mockReturnValue(errAsync(failure));

    const outcome = await collectResult(service.verify('user-1', 'AnyPass'));

    expect(outcome).toEqual({ ok: false, error: failure });
    expect(rateLimitService.recordReauthFailure).not.toHaveBeenCalled();
  });

  it('propagates a rate-limit failure before verifying', async () => {
    const failure = createDomainFailure({
      kind: 'rate_limited',
      code: 'RATE_LIMITED',
      retryAfter: 300,
    });
    rateLimitService.checkReauthRateLimit.mockReturnValue(errAsync(failure));

    const outcome = await collectResult(
      service.verify('user-1', 'Passw0rd123'),
    );

    expect(outcome).toEqual({ ok: false, error: failure });
    expect(adapter.verifyPasswordForUser).not.toHaveBeenCalled();
  });
});
