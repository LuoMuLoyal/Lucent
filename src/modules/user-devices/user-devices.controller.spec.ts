import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserDevicesController } from './user-devices.controller';
import { UserDevicesService } from './services';

describe('UserDevicesController', () => {
  let controller: UserDevicesController;
  let userDevicesService: vi.Mocked<
    Pick<UserDevicesService, 'register' | 'list' | 'remove'>
  >;

  const mockDeviceItem = {
    id: 'device-1',
    platform: 'ios',
    deviceName: 'iPhone 15',
    notificationsEnabled: true,
    locale: 'zh-CN',
    timezone: 'Asia/Shanghai',
    lastSeenAt: '2026-07-20T12:00:00.000Z',
    createdAt: '2026-07-20T10:00:00.000Z',
    updatedAt: '2026-07-20T12:00:00.000Z',
  };

  const user = { sub: 'user-1', email: 'test@example.com', status: 'active' };

  beforeEach(async () => {
    userDevicesService = {
      register: vi.fn().mockResolvedValue(mockDeviceItem),
      list: vi.fn().mockResolvedValue({ items: [mockDeviceItem] }),
      remove: vi.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserDevicesController],
      providers: [
        { provide: UserDevicesService, useValue: userDevicesService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UserDevicesController>(UserDevicesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ── register ───────────────────────────────────────────────────────────

  it('should call service.register and return success envelope', async () => {
    const dto = {
      pushToken: 'token-abc',
      platform: 'ios',
      deviceName: 'iPhone 15',
      locale: 'zh-CN',
      timezone: 'Asia/Shanghai',
      notificationsEnabled: true,
    };

    const result = await controller.register(user, dto);

    expect(userDevicesService.register).toHaveBeenCalledWith('user-1', dto);
    expect(result).toEqual({
      code: 0,
      message: '',
      data: mockDeviceItem,
    });
  });

  // ── list ───────────────────────────────────────────────────────────────

  it('should call service.list and return success envelope', async () => {
    const result = await controller.list(user);

    expect(userDevicesService.list).toHaveBeenCalledWith('user-1');
    expect(result).toEqual({
      code: 0,
      message: '',
      data: { items: [mockDeviceItem] },
    });
  });

  it('should return empty items list when no devices', async () => {
    userDevicesService.list.mockResolvedValueOnce({ items: [] });

    const result = await controller.list(user);

    expect(result).toEqual({
      code: 0,
      message: '',
      data: { items: [] },
    });
  });

  // ── remove ─────────────────────────────────────────────────────────────

  it('should call service.remove with user id and device id', async () => {
    await controller.remove(user, 'device-1');

    expect(userDevicesService.remove).toHaveBeenCalledWith(
      'user-1',
      'device-1',
    );
  });

  it('should not throw when remove succeeds', async () => {
    await expect(controller.remove(user, 'device-1')).resolves.toBeUndefined();
  });
});
