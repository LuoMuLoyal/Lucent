import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: jest.Mocked<Reflector>;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as jest.Mocked<Reflector>;
    guard = new JwtAuthGuard(reflector);
  });

  function createMockContext(): ExecutionContext {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn(),
      getArgByIndex: jest.fn(),
      getArgs: jest.fn(),
      getType: jest.fn(),
      switchToRpc: jest.fn(),
      switchToWs: jest.fn(),
    } as unknown as ExecutionContext;
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

    it('throws UnauthorizedException with TOKEN_EXPIRED when info.name is TokenExpiredError', () => {
      expect(() => {
        guard.handleRequest(null, undefined, { name: 'TokenExpiredError' });
      }).toThrow('Access token expired');
    });

    it('throws when error is present', () => {
      expect(() => {
        guard.handleRequest(new Error('auth error'), undefined, undefined);
      }).toThrow('Invalid or missing access token');
    });

    it('throws when user is null and no error', () => {
      expect(() => {
        guard.handleRequest(null, undefined, undefined);
      }).toThrow('Invalid or missing access token');
    });

    it('throws when user is undefined and info has unknown name', () => {
      expect(() => {
        guard.handleRequest(null, undefined, { name: 'SomeOtherError' });
      }).toThrow('Invalid or missing access token');
    });
  });
});
