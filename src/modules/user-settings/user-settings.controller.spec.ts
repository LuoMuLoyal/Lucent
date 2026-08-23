import { Test, type TestingModule } from '@nestjs/testing';
import { UserSettingsController } from './user-settings.controller';
import { UserSettingsService } from './services/user-settings.service';
import { SecurityPinService } from '../security-pin';
import type { UserSettingsDataDto } from './dto/response.dto';
import { createDomainFailure, errAsync, okAsync } from '../../common/result';

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

  it('should return user settings resource', async () => {
    const settings = makeSettings();
    service.getSettings.mockResolvedValue(settings);

    expect(
      await controller.getSettings({
        sub: 'u1',
        email: 'a@b.c',
        status: 'active',
      }),
    ).toEqual(settings);
    expect(service.getSettings).toHaveBeenCalledWith('u1');
  });

  it('should update settings and return the result', async () => {
    const updated = makeSettings({ aiSummariesEnabled: false });
    service.updateSettings.mockReturnValue(okAsync(updated));

    const result = await controller.updateSettings(
      { sub: 'u1', email: 'a@b.c', status: 'active' },
      { aiSummariesEnabled: false },
    );

    expect(result).toBeDefined();
    expect(result.aiSummariesEnabled).toBe(false);
    expect(service.updateSettings).toHaveBeenCalledWith('u1', {
      aiSummariesEnabled: false,
    });
  });

  it('folds an update failure into DomainFailureException', async () => {
    service.updateSettings.mockReturnValue(
      errAsync(
        createDomainFailure({
          kind: 'conflict',
          code: 'RESOURCE_CONFLICT',
        }),
      ),
    );

    await expect(
      controller.updateSettings(
        { sub: 'u1', email: 'a@b.c', status: 'active' },
        { aiSummariesEnabled: false },
      ),
    ).rejects.toMatchObject({
      name: 'DomainFailureException',
      failure: { code: 'RESOURCE_CONFLICT' },
    });
  });

  it('enables security pin from settings and returns updated settings', async () => {
    securityPinService.enable.mockReturnValue(okAsync(undefined));
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
    expect(result).toBeDefined();
  });

  it('verifies security pin and returns elevation token', async () => {
    securityPinService.verify.mockReturnValue(
      okAsync({
        elevationToken: 'token',
        expiresAt: '2026-07-03T12:15:00.000Z',
      }),
    );

    const result = await controller.verifySecurityPin(
      { sub: 'u1', email: 'a@b.c', status: 'active' },
      { pin: '123456' },
    );

    expect(securityPinService.verify).toHaveBeenCalledWith('u1', {
      pin: '123456',
    });
    expect(result.elevationToken).toBe('token');
    expect(result.expiresAt).toBe('2026-07-03T12:15:00.000Z');
  });

  it('folds a wrong-PIN failure into DomainFailureException', async () => {
    securityPinService.verify.mockReturnValue(
      errAsync(
        createDomainFailure({
          kind: 'authentication',
          code: 'AUTH_ELEVATION_REQUIRED',
        }),
      ),
    );

    await expect(
      controller.verifySecurityPin(
        { sub: 'u1', email: 'a@b.c', status: 'active' },
        { pin: '999999' },
      ),
    ).rejects.toMatchObject({
      name: 'DomainFailureException',
      failure: { code: 'AUTH_ELEVATION_REQUIRED' },
    });
  });

  it('changes security pin and returns updated settings', async () => {
    securityPinService.change.mockReturnValue(okAsync(undefined));
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
    expect(result).toBeDefined();
  });

  it('disables security pin and returns updated settings', async () => {
    securityPinService.disable.mockReturnValue(okAsync(undefined));
    const settings = makeSettings();
    service.getSettings.mockResolvedValue(settings);

    const result = await controller.disableSecurityPin(
      { sub: 'u1', email: 'a@b.c', status: 'active' },
      { pin: '123456' },
    );

    expect(securityPinService.disable).toHaveBeenCalledWith('u1', {
      pin: '123456',
    });
    expect(result).toBeDefined();
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
    passwordReauthenticationRequired: true,
    ...overrides,
  };
}
