import type { NextFunction, Request, Response } from 'express';
import { bindRequestContextMiddleware } from './request-context.middleware';
import type { RequestContextService } from './request-context.service';

describe('request-context.middleware', () => {
  describe('bindRequestContextMiddleware', () => {
    it('returns a middleware function', () => {
      const requestContextService = {
        run: jest.fn(),
      } as unknown as jest.Mocked<RequestContextService>;

      const middleware = bindRequestContextMiddleware(requestContextService);
      expect(typeof middleware).toBe('function');
    });

    it('calls requestContextService.run with requestId from request', () => {
      const runSpy = jest.fn((ctx: unknown, next: NextFunction) => {
        next();
      });
      const requestContextService = {
        run: runSpy,
      } as unknown as jest.Mocked<RequestContextService>;

      const middleware = bindRequestContextMiddleware(requestContextService);
      const request = { requestId: 'req-123' } as unknown as Request;
      const response = {} as Response;
      const next: NextFunction = jest.fn();

      middleware(request, response, next);

      expect(runSpy).toHaveBeenCalledWith({ requestId: 'req-123' }, next);
    });

    it('passes next to requestContextService.run', () => {
      const runSpy = jest.fn();
      const requestContextService = {
        run: runSpy,
      } as unknown as jest.Mocked<RequestContextService>;

      const middleware = bindRequestContextMiddleware(requestContextService);
      const request = { requestId: 'abc' } as unknown as Request;
      const response = {} as Response;
      const next: NextFunction = jest.fn();

      middleware(request, response, next);

      expect(runSpy).toHaveBeenCalledWith(expect.anything(), next);
    });

    it('handles undefined requestId', () => {
      const runSpy = jest.fn((ctx: unknown, next: NextFunction) => {
        next();
      });
      const requestContextService = {
        run: runSpy,
      } as unknown as jest.Mocked<RequestContextService>;

      const middleware = bindRequestContextMiddleware(requestContextService);
      const request = {} as Request;
      const response = {} as Response;
      const next: NextFunction = jest.fn();

      middleware(request, response, next);

      expect(runSpy).toHaveBeenCalledWith({ requestId: undefined }, next);
    });
  });
});
