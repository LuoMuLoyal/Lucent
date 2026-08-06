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

  it('skips delivery when JPush is not configured', async () => {
    provider = buildProvider({ isConfigured: false });
    service = new PushDeliveryService(provider);

    await service.sendToUser('user-1', {
      title: 'Test',
      body: 'Body',
    });

    expect(provider.send).not.toHaveBeenCalled();
  });

  it('sends the user id as the JPush alias', async () => {
    const payload = {
      title: 'Reminder',
      body: 'Take medicine',
      data: { reminderId: 'r1' },
    };

    await service.sendToUser('user-1', payload);

    expect(provider.send).toHaveBeenCalledWith(['user-1'], payload);
  });

  it('swallows provider errors and does not throw', async () => {
    provider.send.mockRejectedValue(new Error('JPush unavailable'));

    await expect(
      service.sendToUser('user-1', { title: 'Test', body: 'Body' }),
    ).resolves.toBeUndefined();
  });
});
