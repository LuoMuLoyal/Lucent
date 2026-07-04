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
});
