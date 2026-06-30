import { EnvironmentService } from './services/environment.service';

describe('EnvironmentService', () => {
  let service: EnvironmentService;

  beforeEach(() => {
    service = new EnvironmentService();
  });

  it('should return the default static snapshot when no coordinates are provided', () => {
    const result = service.getSnapshot({});

    expect(result).toMatchObject({
      dataSource: 'static',
      updatedAt: '2026-06-06T00:00:00.000Z',
      regionHint: 'Global reference baseline',
      pollen: {
        level: 'medium',
        primaryType: 'grass',
      },
      uv: {
        index: 6,
        level: 'high',
      },
      airQuality: {
        level: 'moderate',
        primaryPollutant: 'pm2.5',
      },
      temperature: {
        celsius: 24,
      },
      humidity: {
        percent: 58,
      },
    });
  });

  it('should use the lat/lon static region branch when coordinates are provided', () => {
    const result = service.getSnapshot({
      lat: 31.2304,
      lon: 121.4737,
    });

    expect(result).toMatchObject({
      dataSource: 'static',
      regionHint: 'China temperate latitude band',
      pollen: {
        value: 22,
      },
      uv: {
        index: 7,
      },
      airQuality: {
        aqi: 88,
      },
      temperature: {
        celsius: 25,
      },
      humidity: {
        percent: 64,
      },
    });
  });
});
