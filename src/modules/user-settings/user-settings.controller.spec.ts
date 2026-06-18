import { Test, type TestingModule } from '@nestjs/testing';
import { ResultCode } from '../../common/api-envelope';
import { UserSettingsController } from './user-settings.controller';
import { UserSettingsService } from './user-settings.service';
import type { UserSettingsDataDto } from './dto';

describe('UserSettingsController', () => {
  let controller: UserSettingsController;
  let service: jest.Mocked<UserSettingsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserSettingsController],
      providers: [
        {
          provide: UserSettingsService,
          useValue: {
            getSettings: jest.fn(),
            updateSettings: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(UserSettingsController);
    service = module.get(UserSettingsService);
  });

  it('should return user settings envelope', async () => {
    const settings = makeSettings();
    service.getSettings.mockResolvedValue(settings);

    expect(await controller.getSettings({ sub: 'u1', email: 'a@b.c' })).toEqual(
      {
        code: ResultCode.SUCCESS,
        message: '',
        data: settings,
      },
    );
    expect(service.getSettings).toHaveBeenCalledWith('u1');
  });

  it('should update settings and return the result', async () => {
    const updated = makeSettings({ aiSummariesEnabled: false });
    service.updateSettings.mockResolvedValue(updated);

    const result = await controller.updateSettings(
      { sub: 'u1', email: 'a@b.c' },
      { aiSummariesEnabled: false },
    );

    expect(result.data).toBeDefined();
    expect(result.data?.aiSummariesEnabled).toBe(false);
    expect(service.updateSettings).toHaveBeenCalledWith('u1', {
      aiSummariesEnabled: false,
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
    assistantContext: {
      healthProfile: true,
      dailyRecords: true,
      sleepRecords: true,
      currentMedicines: true,
    },
    updatedAt: '2026-06-10T00:00:00.000Z',
    ...overrides,
  };
}
