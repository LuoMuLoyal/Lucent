import type { NextFunction, Request, Response } from 'express';
import {
  requestIdMiddleware,
  REQUEST_ID_HEADER,
  type RequestWithId,
} from './request-id.middleware';

describe('requestIdMiddleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFn: NextFunction;

  beforeEach(() => {
    mockRequest = {
      header: jest.fn(),
    };
    mockResponse = {
      setHeader: jest.fn(),
    };
    nextFn = jest.fn();
  });

  it('should generate a UUID when no request id header is present', () => {
    (mockRequest.header as jest.Mock).mockReturnValue(undefined);

    requestIdMiddleware(
      mockRequest as Request,
      mockResponse as Response,
      nextFn,
    );

    const requestId = (mockRequest as RequestWithId).requestId;
    expect(requestId).toBeDefined();
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(mockResponse.setHeader).toHaveBeenCalledWith(
      REQUEST_ID_HEADER,
      requestId,
    );
    expect(nextFn).toHaveBeenCalled();
  });

  it('should use incoming request id when present', () => {
    const incomingId = 'custom-request-id-123';
    (mockRequest.header as jest.Mock).mockReturnValue(incomingId);

    requestIdMiddleware(
      mockRequest as Request,
      mockResponse as Response,
      nextFn,
    );

    expect((mockRequest as RequestWithId).requestId).toBe(incomingId);
    expect(mockResponse.setHeader).toHaveBeenCalledWith(
      REQUEST_ID_HEADER,
      incomingId,
    );
  });

  it('should trim whitespace from incoming request id', () => {
    (mockRequest.header as jest.Mock).mockReturnValue('  trimmed-id  ');

    requestIdMiddleware(
      mockRequest as Request,
      mockResponse as Response,
      nextFn,
    );

    expect((mockRequest as RequestWithId).requestId).toBe('trimmed-id');
  });

  it('should generate UUID when incoming request id is empty string', () => {
    (mockRequest.header as jest.Mock).mockReturnValue('');

    requestIdMiddleware(
      mockRequest as Request,
      mockResponse as Response,
      nextFn,
    );

    const requestId = (mockRequest as RequestWithId).requestId;
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('should generate UUID when incoming request id is only whitespace', () => {
    (mockRequest.header as jest.Mock).mockReturnValue('   ');

    requestIdMiddleware(
      mockRequest as Request,
      mockResponse as Response,
      nextFn,
    );

    const requestId = (mockRequest as RequestWithId).requestId;
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('should always call next()', () => {
    (mockRequest.header as jest.Mock).mockReturnValue(undefined);

    requestIdMiddleware(
      mockRequest as Request,
      mockResponse as Response,
      nextFn,
    );

    expect(nextFn).toHaveBeenCalledTimes(1);
  });

  it('should set X-Request-Id response header', () => {
    (mockRequest.header as jest.Mock).mockReturnValue('test-id');

    requestIdMiddleware(
      mockRequest as Request,
      mockResponse as Response,
      nextFn,
    );

    expect(mockResponse.setHeader).toHaveBeenCalledWith(
      REQUEST_ID_HEADER,
      'test-id',
    );
  });
});
