import { Test, type TestingModule } from '@nestjs/testing';
import { UserSettingsController } from './user-settings.controller';
import { UserSettingsService } from './services/user-settings.service';
import type { UserSettingsDataDto } from './dto/response.dto';
import { createDomainFailure, errAsync, okAsync } from '../../common/result';

describe('UserSettingsController', () => {
  let controller: UserSettingsController;
  let service: vi.Mocked<UserSettingsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserSettingsController],
      providers: [
        {
          provide: UserSettingsService,
          useValue: {
            getSettings: vi.fn(),
            updateSettings: vi.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(UserSettingsController);
    service = module.get(UserSettingsService);
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
