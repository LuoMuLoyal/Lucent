import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';

import { currentUserFactory } from './current-user.decorator.js';
import type { UserPayload } from '../services/auth.service.js';

function createMockContext(user?: UserPayload): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as ExecutionContext;
}

describe('currentUserFactory', () => {
  const mockUser: UserPayload = {
    sub: 'user-123',
    email: 'test@example.com',
    status: 'active',
  };

  it('returns the full user object when no field is specified', () => {
    const ctx = createMockContext(mockUser);

    const result = currentUserFactory(undefined, ctx);

    expect(result).toBe(mockUser);
  });

  it('returns a specific field when data is provided', () => {
    const ctx = createMockContext(mockUser);

    const result = currentUserFactory('sub', ctx);

    expect(result).toBe('user-123');
  });

  it('returns email field when requested', () => {
    const ctx = createMockContext(mockUser);

    const result = currentUserFactory('email', ctx);

    expect(result).toBe('test@example.com');
  });

  it('returns status field when requested', () => {
    const ctx = createMockContext(mockUser);

    const result = currentUserFactory('status', ctx);

    expect(result).toBe('active');
  });

  it('returns undefined when user is not present on request', () => {
    const ctx = createMockContext(undefined);

    const result = currentUserFactory(undefined, ctx);

    expect(result).toBeUndefined();
  });

  it('returns undefined when user is absent and a field is requested', () => {
    const ctx = createMockContext(undefined);

    const result = currentUserFactory('sub', ctx);

    expect(result).toBeUndefined();
  });
});
