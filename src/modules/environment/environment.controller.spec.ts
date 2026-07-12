import { Test, type TestingModule } from '@nestjs/testing';
import { ResultCode } from '../../common/api';
import type { EnvironmentSnapshotDto } from './dto';
import { EnvironmentController } from './environment.controller';
import { EnvironmentService } from './services/environment.service';

describe('EnvironmentController', () => {
  let controller: EnvironmentController;
  let service: vi.Mocked<EnvironmentService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EnvironmentController],
      providers: [
        {
          provide: EnvironmentService,
          useValue: {
            getSnapshot: vi.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(EnvironmentController);
    service = module.get(EnvironmentService);
  });

  it('should return an environment snapshot envelope for the default request', () => {
    const snapshot = makeSnapshot({
      regionHint: 'Global reference baseline',
    });
    service.getSnapshot.mockReturnValue(snapshot);

    expect(controller.getSnapshot({})).toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: snapshot,
    });
    expect(service.getSnapshot).toHaveBeenCalledWith({});
  });

  it('should pass lat/lon query values to the snapshot service', () => {
    const query = {
      lat: 31.2304,
      lon: 121.4737,
    };
    const snapshot = makeSnapshot({
      regionHint: 'China temperate latitude band',
    });
    service.getSnapshot.mockReturnValue(snapshot);

    expect(controller.getSnapshot(query).data?.regionHint).toBe(
      'China temperate latitude band',
    );
    expect(service.getSnapshot).toHaveBeenCalledWith(query);
  });
});

function makeSnapshot(
  overrides: Partial<EnvironmentSnapshotDto> = {},
): EnvironmentSnapshotDto {
  return {
    dataSource: 'static',
    updatedAt: '2026-06-06T00:00:00.000Z',
    regionHint: 'Global reference baseline',
    pollen: {
      level: 'medium',
      primaryType: 'grass',
      value: 18,
      unit: 'grains/m3',
    },
    uv: {
      index: 6,
      level: 'high',
    },
    airQuality: {
      aqi: 82,
      level: 'moderate',
      primaryPollutant: 'pm2.5',
    },
    temperature: {
      celsius: 24,
      feelsLike: 26,
    },
    humidity: {
      percent: 58,
    },
    ...overrides,
  };
}
