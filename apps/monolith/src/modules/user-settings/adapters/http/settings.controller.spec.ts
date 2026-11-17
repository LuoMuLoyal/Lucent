import { Test, type TestingModule } from '@nestjs/testing';
import { UserSettingsController } from './settings.controller.js';
import { UserSettingsService } from '../../application/services/user-settings.js';
import type { UserSettingsDataDto } from './dto/response.js';
import {
  createDomainFailure,
  errAsync,
  okAsync,
} from '../../../../common/result/index.js';

const USER: { sub: string; email: string; status: string } = {
  sub: 'u1',
  email: 'a@b.c',
  status: 'active',
};

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
    updatedAt: null,
    passwordReauthenticationRequired: true,
    ...overrides,
  };
}

describe('UserSettingsController', () => {
  let controller: UserSettingsController;
  let service: {
    getSettings: ReturnType<typeof vi.fn>;
    updateSettings: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserSettingsController],
      providers: [
        {
          provide: UserSettingsService,
          useValue: { getSettings: vi.fn(), updateSettings: vi.fn() },
        },
      ],
    }).compile();

    controller = module.get(UserSettingsController);
    service = module.get(UserSettingsService);
  });

  it('returns the settings resource for the authenticated user', async () => {
    const settings = makeSettings();
    service.getSettings.mockResolvedValue(settings);

    await expect(controller.getSettings(USER as never)).resolves.toEqual(
      settings,
    );
    expect(service.getSettings).toHaveBeenCalledWith('u1');
  });

  it('unwraps a successful update', async () => {
    service.updateSettings.mockReturnValue(
      okAsync(makeSettings({ aiSummariesEnabled: false })),
    );

    const result = await controller.updateSettings(USER as never, {
      aiSummariesEnabled: false,
    });

    expect(result.aiSummariesEnabled).toBe(false);
    expect(service.updateSettings).toHaveBeenCalledWith('u1', {
      aiSummariesEnabled: false,
    });
  });

  it('throws the problem-details exception on a conflict', async () => {
    service.updateSettings.mockReturnValue(
      errAsync(
        createDomainFailure({ kind: 'conflict', code: 'RESOURCE_CONFLICT' }),
      ),
    );

    await expect(
      controller.updateSettings(USER as never, { assistantEnabled: false }),
    ).rejects.toMatchObject({
      failure: { kind: 'conflict', code: 'RESOURCE_CONFLICT' },
    });
  });
});
