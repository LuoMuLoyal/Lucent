import { EnvironmentService } from './snapshot.service.js';

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

  it('should fall back to default when only lat is provided', () => {
    const result = service.getSnapshot({ lat: 31.2304 });
    expect(result.regionHint).toBe('Global reference baseline');
  });

  it('should fall back to default when only lon is provided', () => {
    const result = service.getSnapshot({ lon: 121.4737 });
    expect(result.regionHint).toBe('Global reference baseline');
  });

  it('should select tropical band for low-latitude coordinates', () => {
    const result = service.getSnapshot({ lat: 10, lon: 100 });
    expect(result.regionHint).toBe('Tropical latitude band');
    expect(result.uv.index).toBe(10);
  });

  it('should select high-latitude band for polar coordinates', () => {
    const result = service.getSnapshot({ lat: 60, lon: 10 });
    expect(result.regionHint).toBe('High latitude band');
    expect(result.uv.index).toBe(3);
  });

  it('should select southern mid-latitude band for southern hemisphere', () => {
    const result = service.getSnapshot({ lat: -35, lon: 140 });
    expect(result.regionHint).toBe('Southern hemisphere latitude band');
    expect(result.pollen.level).toBe('low');
  });

  it('should select northern mid-latitude band for northern hemisphere non-China', () => {
    const result = service.getSnapshot({ lat: 40, lon: -74 });
    expect(result.regionHint).toBe('Northern hemisphere latitude band');
    expect(result.pollen.primaryType).toBe('tree');
  });

  it('should always return dataSource as static', () => {
    const result = service.getSnapshot({ lat: 0, lon: 0 });
    expect(result.dataSource).toBe('static');
  });
});
