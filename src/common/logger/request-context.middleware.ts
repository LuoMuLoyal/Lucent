import type { NextFunction, Request, Response } from 'express';
import type { RequestContextService } from './request-context.service';
import type { RequestWithId } from '../middleware/request-id.middleware';

export function bindRequestContextMiddleware(
  requestContextService: RequestContextService,
) {
  return (request: Request, _response: Response, next: NextFunction): void => {
    requestContextService.run(
      {
        requestId: (request as RequestWithId).requestId,
      },
      next,
    );
  };
}
