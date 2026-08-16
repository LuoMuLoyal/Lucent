import { PushDeliveryService } from './push-delivery.service';
import type { PushMessage, PushProvider } from './push-provider.port';

function buildProvider(
  overrides: Partial<PushProvider> = {},
): vi.Mocked<PushProvider> {
  return {
    isConfigured: true,
    send: vi.fn((_aliases: string[], _message: PushMessage) =>
      Promise.resolve(),
    ),
    ...overrides,
  } as vi.Mocked<PushProvider>;
}

describe('PushDeliveryService', () => {
  let service: PushDeliveryService;
  let provider: vi.Mocked<PushProvider>;

  beforeEach(() => {
    provider = buildProvider();
    service = new PushDeliveryService(provider);
  });

  it('returns { sent: false, errorMessage: push_not_configured } when JPush is not configured', async () => {
    provider = buildProvider({ isConfigured: false });
    service = new PushDeliveryService(provider);

    const result = await service.sendToUser('user-1', {
      title: 'Test',
      body: 'Body',
    });

    expect(provider.send).not.toHaveBeenCalled();
    expect(result).toEqual({
      sent: false,
      errorMessage: 'push_not_configured',
    });
  });

  it('sends the user id as the JPush alias and reports success', async () => {
    const payload = {
      title: 'Reminder',
      body: 'Take medicine',
      data: { reminderId: 'r1' },
    };

    const result = await service.sendToUser('user-1', payload);

    expect(provider.send).toHaveBeenCalledWith(['user-1'], payload);
    expect(result).toEqual({ sent: true });
  });

  it('swallows provider errors and reports failure with the error message', async () => {
    provider.send.mockRejectedValue(new Error('JPush unavailable'));

    const result = await service.sendToUser('user-1', {
      title: 'Test',
      body: 'Body',
    });

    expect(result).toEqual({
      sent: false,
      errorMessage: 'JPush unavailable',
    });
  });
});
