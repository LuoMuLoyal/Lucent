import type { AdminResource } from '../constants/resource-registry.js';
import type { AdminDataService, AdminResourcePage } from './data.service.js';
import { AdminUserRelatedService } from './user-related.service.js';

describe('AdminUserRelatedService', () => {
  function buildService() {
    const getOne = vi.fn<
      (r: AdminResource, id: string) => Promise<Record<string, unknown> | null>
    >();
    const list = vi.fn<
      (r: AdminResource, q: unknown) => Promise<AdminResourcePage>
    >();
    const data = { getOne, list } as unknown as AdminDataService;
    const service = new AdminUserRelatedService(data);
    return { service, getOne, list };
  }

  it('returns null when the user does not exist', async () => {
    const { service, getOne, list } = buildService();
    getOne.mockResolvedValue(null);

    await expect(service.getForUser('missing', 10)).resolves.toBeNull();
    expect(getOne).toHaveBeenCalledTimes(1);
    expect(list).not.toHaveBeenCalled();
  });

  it('aggregates every group with previews and totals', async () => {
    const { service, getOne, list } = buildService();
    getOne.mockImplementation((resource: AdminResource) =>
      Promise.resolve(
        resource.key === 'users'
          ? { id: 'u1' }
          : resource.key === 'user-profiles'
            ? { userId: 'u1', locale: 'zh' }
            : null,
      ),
    );
    list.mockImplementation((resource: AdminResource) =>
      Promise.resolve({
        items: [{ id: `${resource.key}-1` }],
        total: 3,
        page: 1,
        limit: 10,
      }),
    );

    const result = await service.getForUser('u1', 10);
    expect(result).not.toBeNull();
    if (result === null) return;

    expect(result.userId).toBe('u1');
    expect(result.groups.map((g) => g.key)).toEqual([
      'account',
      'health',
      'medication',
      'records',
      'events',
      'suggestions',
      'assistant',
      'notifications',
      'privacy',
      'telemetry',
    ]);

    const account = result.groups.find((g) => g.key === 'account');
    expect(account?.sections.map((s) => s.resource)).toEqual([
      'accounts',
      'user-sessions',
      'user-settings',
      'user-profiles',
    ]);
    expect(account?.sections[0]).toEqual({
      resource: 'accounts',
      items: [{ id: 'accounts-1' }],
      total: 3,
    });
    expect(account?.sections[3]).toEqual({
      resource: 'user-profiles',
      items: [{ userId: 'u1', locale: 'zh' }],
      total: 1,
    });

    const notifications = result.groups.find((g) => g.key === 'notifications');
    expect(notifications?.sections[0]).toEqual({
      resource: 'user-notification-preferences',
      items: [],
      total: 0,
    });
  });

  it('filters listed sections by userId with the requested limit', async () => {
    const { service, getOne, list } = buildService();
    getOne.mockImplementation((resource: AdminResource) =>
      Promise.resolve(resource.key === 'users' ? { id: 'u1' } : null),
    );
    list.mockResolvedValue({ items: [], total: 0, page: 1, limit: 5 });

    await service.getForUser('u1', 5);

    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'accounts' }),
      { page: 1, limit: 5, order: 'desc', userId: 'u1' },
    );
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'user-product-events' }),
      { page: 1, limit: 5, order: 'desc', userId: 'u1' },
    );
  });
});
