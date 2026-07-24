import { Test, type TestingModule } from '@nestjs/testing';
import { ResultCode } from '../../common';
import { UserSettingsController } from './user-settings.controller';
import { UserSettingsService } from './services/user-settings.service';
import { SecurityPinService } from '../security-pin';
import type { UserSettingsDataDto } from './dto/response.dto';

describe('UserSettingsController', () => {
  let controller: UserSettingsController;
  let service: vi.Mocked<UserSettingsService>;
  let securityPinService: vi.Mocked<SecurityPinService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserSettingsController],
      providers: [
        {
          provide: UserSettingsService,
          useValue: {
            getSettings: vi.fn(),
            updateSettings: vi.fn(),
            invalidateUserCache: vi.fn(),
          },
        },
        {
          provide: SecurityPinService,
          useValue: {
            enable: vi.fn(),
            change: vi.fn(),
            disable: vi.fn(),
            verify: vi.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(UserSettingsController);
    service = module.get(UserSettingsService);
    securityPinService = module.get(SecurityPinService);
  });

  it('should return user settings envelope', async () => {
    const settings = makeSettings();
    service.getSettings.mockResolvedValue(settings);

    expect(
      await controller.getSettings({
        sub: 'u1',
        email: 'a@b.c',
        status: 'active',
      }),
    ).toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: settings,
    });
    expect(service.getSettings).toHaveBeenCalledWith('u1');
  });

  it('should update settings and return the result', async () => {
    const updated = makeSettings({ aiSummariesEnabled: false });
    service.updateSettings.mockResolvedValue(updated);

    const result = await controller.updateSettings(
      { sub: 'u1', email: 'a@b.c', status: 'active' },
      { aiSummariesEnabled: false },
    );

    expect(result.data).toBeDefined();
    expect(result.data?.aiSummariesEnabled).toBe(false);
    expect(service.updateSettings).toHaveBeenCalledWith('u1', {
      aiSummariesEnabled: false,
    });
  });

  it('enables security pin from settings and returns updated settings', async () => {
    securityPinService.enable.mockResolvedValue(undefined);
    const settings = makeSettings();
    service.getSettings.mockResolvedValue(settings);

    const result = await controller.enableSecurityPin(
      { sub: 'u1', email: 'a@b.c', status: 'active' },
      { pin: '123456' },
    );

    expect(securityPinService.enable).toHaveBeenCalledWith('u1', {
      pin: '123456',
    });
    expect(service.getSettings).toHaveBeenCalledWith('u1');
    expect(result.data).toBeDefined();
  });

  it('verifies security pin and returns elevation token', async () => {
    securityPinService.verify.mockResolvedValue({
      elevationToken: 'token',
      expiresAt: '2026-07-03T12:15:00.000Z',
    });

    const result = await controller.verifySecurityPin(
      { sub: 'u1', email: 'a@b.c', status: 'active' },
      { pin: '123456' },
    );

    expect(securityPinService.verify).toHaveBeenCalledWith('u1', {
      pin: '123456',
    });
    expect(result.data?.elevationToken).toBe('token');
    expect(result.data?.expiresAt).toBe('2026-07-03T12:15:00.000Z');
  });

  it('changes security pin and returns updated settings', async () => {
    securityPinService.change.mockResolvedValue(undefined);
    const settings = makeSettings();
    service.getSettings.mockResolvedValue(settings);

    const result = await controller.changeSecurityPin(
      { sub: 'u1', email: 'a@b.c', status: 'active' },
      { oldPin: '123456', newPin: '654321' },
    );

    expect(securityPinService.change).toHaveBeenCalledWith('u1', {
      oldPin: '123456',
      newPin: '654321',
    });
    expect(result.data).toBeDefined();
  });

  it('disables security pin and returns updated settings', async () => {
    securityPinService.disable.mockResolvedValue(undefined);
    const settings = makeSettings();
    service.getSettings.mockResolvedValue(settings);

    const result = await controller.disableSecurityPin(
      { sub: 'u1', email: 'a@b.c', status: 'active' },
      { pin: '123456' },
    );

    expect(securityPinService.disable).toHaveBeenCalledWith('u1', {
      pin: '123456',
    });
    expect(result.data).toBeDefined();
  });
});

function makeSettings(
  overrides: Partial<UserSettingsDataDto> = {},
): UserSettingsDataDto {
  return {
    aiSummariesEnabled: true,
    dataSharingConsent: false,
    assistantEnabled: true,
    assistantMemoryEnabled: false,
    waterTargetCount: 8,
    assistantContext: {
      healthProfile: true,
      dailyRecords: true,
      sleepRecords: true,
      currentMedicines: true,
    },
    updatedAt: '2026-06-10T00:00:00.000Z',
    securityPin: {
      enabled: false,
      lastChangedAt: null,
    },
    ...overrides,
  };
}
