import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextStore {
  requestId: string;
}

/**
 * Shared AsyncLocalStorage holding the per-request context. Exported at
 * module level so non-DI consumers (the winston `requestIdFormat` in
 * `logger.config.ts`) can read the active context; `RequestContextService`
 * remains the injectable facade for application code.
 */
export const requestContextStorage =
  new AsyncLocalStorage<RequestContextStore>();

@Injectable()
export class RequestContextService {
  run<T>(store: RequestContextStore, callback: () => T): T {
    return requestContextStorage.run(store, callback);
  }

  getStore(): RequestContextStore | undefined {
    return requestContextStorage.getStore();
  }

  getRequestId(): string | undefined {
    return requestContextStorage.getStore()?.requestId;
  }
}
