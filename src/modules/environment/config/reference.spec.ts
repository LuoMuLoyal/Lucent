import { getStaticEnvironmentSnapshot } from './reference';

describe('getStaticEnvironmentSnapshot', () => {
  it('returns default profile when no coordinates provided', () => {
    const result = getStaticEnvironmentSnapshot({});

    expect(result.dataSource).toBe('static');
    expect(result.regionHint).toBe('Global reference baseline');
    expect(result.pollen.level).toBe('medium');
  });

  it('returns default profile when only lat provided', () => {
    const result = getStaticEnvironmentSnapshot({ lat: 31 });

    expect(result.regionHint).toBe('Global reference baseline');
  });

  it('returns default profile when only lon provided', () => {
    const result = getStaticEnvironmentSnapshot({ lon: 121 });

    expect(result.regionHint).toBe('Global reference baseline');
  });

  it('returns china_temperate profile for Shanghai coordinates', () => {
    const result = getStaticEnvironmentSnapshot({
      lat: 31.2304,
      lon: 121.4737,
    });

    expect(result.regionHint).toBe('China temperate latitude band');
    expect(result.pollen.value).toBe(22);
  });

  it('returns china_temperate at boundary (lat 18, lon 73)', () => {
    const result = getStaticEnvironmentSnapshot({ lat: 18, lon: 73 });

    expect(result.regionHint).toBe('China temperate latitude band');
  });

  it('returns china_temperate at upper boundary (lat 54, lon 135)', () => {
    const result = getStaticEnvironmentSnapshot({ lat: 54, lon: 135 });

    expect(result.regionHint).toBe('China temperate latitude band');
  });

  it('returns tropical profile for equatorial coordinates', () => {
    const result = getStaticEnvironmentSnapshot({ lat: 0, lon: 0 });

    expect(result.regionHint).toBe('Tropical latitude band');
    expect(result.uv.index).toBe(10);
    expect(result.uv.level).toBe('very_high');
  });

  it('returns tropical profile at boundary (abs lat < 23.5)', () => {
    const result = getStaticEnvironmentSnapshot({ lat: 23, lon: -50 });

    expect(result.regionHint).toBe('Tropical latitude band');
  });

  it('returns high_latitude profile for Arctic coordinates', () => {
    const result = getStaticEnvironmentSnapshot({ lat: 70, lon: 0 });

    expect(result.regionHint).toBe('High latitude band');
    expect(result.airQuality.level).toBe('good');
    expect(result.airQuality.primaryPollutant).toBeNull();
  });

  it('returns high_latitude at boundary (abs lat >= 55)', () => {
    const result = getStaticEnvironmentSnapshot({ lat: -55, lon: 0 });

    expect(result.regionHint).toBe('High latitude band');
  });

  it('returns northern_mid_latitude for European coordinates', () => {
    const result = getStaticEnvironmentSnapshot({ lat: 50, lon: 10 });

    expect(result.regionHint).toBe('Northern hemisphere latitude band');
  });

  it('returns southern_mid_latitude for Australian coordinates', () => {
    const result = getStaticEnvironmentSnapshot({ lat: -33, lon: 151 });

    expect(result.regionHint).toBe('Southern hemisphere latitude band');
    expect(result.pollen.level).toBe('low');
  });

  it('always returns static dataSource and updatedAt timestamp', () => {
    const result = getStaticEnvironmentSnapshot({ lat: 31, lon: 121 });

    expect(result.dataSource).toBe('static');
    expect(result.updatedAt).toBe('2026-06-06T00:00:00.000Z');
  });

  it('returns a deep copy (not shared references)', () => {
    const result1 = getStaticEnvironmentSnapshot({ lat: 31, lon: 121 });
    const result2 = getStaticEnvironmentSnapshot({ lat: 31, lon: 121 });

    expect(result1.pollen).not.toBe(result2.pollen);
    expect(result1.pollen).toEqual(result2.pollen);
  });
});
