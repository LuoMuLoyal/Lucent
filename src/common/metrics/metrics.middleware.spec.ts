import type { NextFunction, Request, Response } from 'express';
import { createMetricsMiddleware } from './metrics.middleware';
import type { MetricsService } from './metrics.service';

describe('createMetricsMiddleware', () => {
  let metricsService: jest.Mocked<MetricsService>;
  let middleware: ReturnType<typeof createMetricsMiddleware>;

  beforeEach(() => {
    metricsService = {
      is_enabled: jest.fn().mockReturnValue(true),
      recordHttpRequest: jest.fn(),
    } as unknown as jest.Mocked<MetricsService>;
    middleware = createMetricsMiddleware(metricsService);
  });

  function createMockReq(url: string, method = 'GET'): Request {
    return { url, method, originalUrl: url } as unknown as Request;
  }

  function createMockRes(): Response & { emit: (event: string) => void } {
    const listeners: Record<string, (() => void)[]> = {};
    const res = {
      statusCode: 200,
      on: jest.fn((event: string, cb: () => void) => {
        if (!listeners[event]) {
          listeners[event] = [];
        }
        listeners[event]!.push(cb);
      }),
      emit: (event: string) => {
        listeners[event]?.forEach((cb) => {
          cb();
        });
      },
    };
    return res as unknown as Response & { emit: (event: string) => void };
  }

  it('calls next() immediately', () => {
    const req = createMockReq('/api/v1/test');
    const res = createMockRes();
    const next = jest.fn() as unknown as NextFunction;

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('records metrics on res finish event', () => {
    const req = createMockReq('/api/v1/test');
    const res = createMockRes();
    const next = jest.fn() as unknown as NextFunction;

    middleware(req, res, next);
    res.emit('finish');

    expect(metricsService.recordHttpRequest).toHaveBeenCalledWith(
      'GET',
      '/api/v1/test',
      200,
      expect.any(Number),
    );
  });

  it('skips /metrics endpoint', () => {
    const req = createMockReq('/metrics');
    const res = createMockRes();
    const next = jest.fn() as unknown as NextFunction;

    middleware(req, res, next);
    res.emit('finish');

    expect(metricsService.recordHttpRequest).not.toHaveBeenCalled();
  });

  it('skips /api/v1/health endpoints', () => {
    const req = createMockReq('/api/v1/health/ready');
    const res = createMockRes();
    const next = jest.fn() as unknown as NextFunction;

    middleware(req, res, next);
    res.emit('finish');

    expect(metricsService.recordHttpRequest).not.toHaveBeenCalled();
  });

  it('skips when metrics is disabled', () => {
    metricsService.is_enabled.mockReturnValue(false);
    const req = createMockReq('/api/v1/test');
    const res = createMockRes();
    const next = jest.fn() as unknown as NextFunction;

    middleware(req, res, next);
    res.emit('finish');

    expect(metricsService.recordHttpRequest).not.toHaveBeenCalled();
  });

  it('normalizes UUIDs in the route path', () => {
    const req = createMockReq(
      '/api/v1/users/550e8400-e29b-41d4-a716-446655440000/records',
    );
    const res = createMockRes();
    const next = jest.fn() as unknown as NextFunction;

    middleware(req, res, next);
    res.emit('finish');

    expect(metricsService.recordHttpRequest).toHaveBeenCalledWith(
      'GET',
      '/api/v1/users/:id/records',
      200,
      expect.any(Number),
    );
  });

  it('normalizes numeric IDs in the route path', () => {
    const req = createMockReq('/api/v1/medicines/42/details');
    const res = createMockRes();
    const next = jest.fn() as unknown as NextFunction;

    middleware(req, res, next);
    res.emit('finish');

    expect(metricsService.recordHttpRequest).toHaveBeenCalledWith(
      'GET',
      '/api/v1/medicines/:id/details',
      200,
      expect.any(Number),
    );
  });

  it('strips query strings from the route', () => {
    const req = createMockReq('/api/v1/medicines?search=aspirin&page=2');
    const res = createMockRes();
    const next = jest.fn() as unknown as NextFunction;

    middleware(req, res, next);
    res.emit('finish');

    expect(metricsService.recordHttpRequest).toHaveBeenCalledWith(
      'GET',
      '/api/v1/medicines',
      200,
      expect.any(Number),
    );
  });
});
