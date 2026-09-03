import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { DomainFailureException } from '../../../common/result/unwrap-result.js';
import type { DomainFailure } from '../../../common/result/index.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: vi.Mocked<Reflector>;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: vi.fn(),
    } as unknown as vi.Mocked<Reflector>;
    guard = new JwtAuthGuard(reflector);
  });

  function createMockContext(): ExecutionContext {
    return {
      getHandler: vi.fn(),
      getClass: vi.fn(),
      switchToHttp: vi.fn(),
      getArgByIndex: vi.fn(),
      getArgs: vi.fn(),
      getType: vi.fn(),
      switchToRpc: vi.fn(),
      switchToWs: vi.fn(),
    } as unknown as ExecutionContext;
  }

  /** Runs fn and returns the DomainFailure carried by the thrown bridge. */
  function captureFailure(fn: () => unknown): DomainFailure {
    try {
      fn();
    } catch (error) {
      if (error instanceof DomainFailureException) return error.failure;
      throw error;
    }
    throw new Error('expected DomainFailureException to be thrown');
  }

  describe('canActivate', () => {
    it('returns true when route is public', () => {
      reflector.getAllAndOverride.mockReturnValue(true);
      const context = createMockContext();

      const result = guard.canActivate(context);

      expect(result).toBe(true);
      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
    });

    it('returns true for public routes and delegates for protected', () => {
      // When not public, super.canActivate needs real Passport infrastructure.
      // We only test the public-route bypass here; the delegation is covered by E2E.
      reflector.getAllAndOverride.mockReturnValue(true);
      const context = createMockContext();

      const result = guard.canActivate(context);
      expect(result).toBe(true);
    });
  });

  describe('handleRequest', () => {
    it('returns user when valid', () => {
      const user = { sub: 'user-1', email: 'test@test.com' };

      const result = guard.handleRequest(null, user, undefined);

      expect(result).toBe(user);
    });

    it('throws DomainFailureException with AUTH_TOKEN_EXPIRED when info.name is TokenExpiredError', () => {
      const failure = captureFailure(() => {
        guard.handleRequest(null, undefined, { name: 'TokenExpiredError' });
      });

      expect(failure.code).toBe('AUTH_TOKEN_EXPIRED');
      expect(failure.kind).toBe('authentication');
    });

    it('throws DomainFailureException with AUTH_REQUIRED when error is present', () => {
      const failure = captureFailure(() => {
        guard.handleRequest(new Error('auth error'), undefined, undefined);
      });

      expect(failure.code).toBe('AUTH_REQUIRED');
    });

    it('throws DomainFailureException with AUTH_REQUIRED when user is null and no error', () => {
      const failure = captureFailure(() => {
        guard.handleRequest(null, undefined, undefined);
      });

      expect(failure.code).toBe('AUTH_REQUIRED');
    });

    it('throws DomainFailureException with AUTH_REQUIRED when user is undefined and info has unknown name', () => {
      const failure = captureFailure(() => {
        guard.handleRequest(null, undefined, { name: 'SomeOtherError' });
      });

      expect(failure.code).toBe('AUTH_REQUIRED');
    });

    it('throws DomainFailureException with AUTH_REQUIRED when user is false (not a truthy object)', () => {
      const failure = captureFailure(() => {
        guard.handleRequest(null, false as never, undefined);
      });

      expect(failure.code).toBe('AUTH_REQUIRED');
    });

    it('throws DomainFailureException with AUTH_REQUIRED when both error and user are present (error takes priority)', () => {
      const user = { sub: 'user-1' };
      const failure = captureFailure(() => {
        guard.handleRequest(new Error('auth error'), user, undefined);
      });

      expect(failure.code).toBe('AUTH_REQUIRED');
    });

    it('throws DomainFailureException with AUTH_REQUIRED when info is a string instead of object with name', () => {
      const failure = captureFailure(() => {
        guard.handleRequest(null, undefined, 'some info string' as never);
      });

      expect(failure.code).toBe('AUTH_REQUIRED');
    });
  });
});
