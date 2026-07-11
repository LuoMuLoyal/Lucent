import { RequestContextService } from './request-context.service';

describe('RequestContextService', () => {
  it('returns the active request id inside a context run', async () => {
    const service = new RequestContextService();

    await new Promise<void>((resolve) => {
      service.run({ requestId: 'req-123' }, () => {
        expect(service.getRequestId()).toBe('req-123');
        resolve();
      });
    });
  });

  it('returns undefined outside an active context', () => {
    const service = new RequestContextService();

    expect(service.getRequestId()).toBeUndefined();
    expect(service.getStore()).toBeUndefined();
  });

  it('supports nested contexts with different requestIds', async () => {
    const service = new RequestContextService();

    await new Promise<void>((resolve) => {
      service.run({ requestId: 'outer' }, () => {
        expect(service.getRequestId()).toBe('outer');

        service.run({ requestId: 'inner' }, () => {
          expect(service.getRequestId()).toBe('inner');
        });

        // After inner context completes, outer is restored
        expect(service.getRequestId()).toBe('outer');
        resolve();
      });
    });
  });

  it('getStore returns the full store object inside a context', async () => {
    const service = new RequestContextService();

    await new Promise<void>((resolve) => {
      service.run({ requestId: 'req-store' }, () => {
        const store = service.getStore();
        expect(store).toEqual({ requestId: 'req-store' });
        resolve();
      });
    });
  });
});
