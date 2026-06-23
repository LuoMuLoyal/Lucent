import type { EnvironmentSnapshotDto } from '../dto';

export interface EnvironmentSnapshotLocationInput {
  lat?: number;
  lon?: number;
}

export const STATIC_ENVIRONMENT_UPDATED_AT = '2026-06-06T00:00:00.000Z';

type StaticEnvironmentRegionKey =
  | 'default'
  | 'china_temperate'
  | 'tropical'
  | 'northern_mid_latitude'
  | 'southern_mid_latitude'
  | 'high_latitude';

type StaticEnvironmentProfile = Omit<
  EnvironmentSnapshotDto,
  'dataSource' | 'updatedAt'
>;

const STATIC_ENVIRONMENT_PROFILES = {
  default: {
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
  },
  china_temperate: {
    regionHint: 'China temperate latitude band',
    pollen: {
      level: 'medium',
      primaryType: 'grass',
      value: 22,
      unit: 'grains/m3',
    },
    uv: {
      index: 7,
      level: 'high',
    },
    airQuality: {
      aqi: 88,
      level: 'moderate',
      primaryPollutant: 'pm2.5',
    },
    temperature: {
      celsius: 25,
      feelsLike: 28,
    },
    humidity: {
      percent: 64,
    },
  },
  tropical: {
    regionHint: 'Tropical latitude band',
    pollen: {
      level: 'medium',
      primaryType: 'grass',
      value: 20,
      unit: 'grains/m3',
    },
    uv: {
      index: 10,
      level: 'very_high',
    },
    airQuality: {
      aqi: 76,
      level: 'moderate',
      primaryPollutant: 'o3',
    },
    temperature: {
      celsius: 29,
      feelsLike: 34,
    },
    humidity: {
      percent: 78,
    },
  },
  northern_mid_latitude: {
    regionHint: 'Northern hemisphere latitude band',
    pollen: {
      level: 'medium',
      primaryType: 'tree',
      value: 16,
      unit: 'grains/m3',
    },
    uv: {
      index: 6,
      level: 'high',
    },
    airQuality: {
      aqi: 72,
      level: 'moderate',
      primaryPollutant: 'pm2.5',
    },
    temperature: {
      celsius: 22,
      feelsLike: 23,
    },
    humidity: {
      percent: 55,
    },
  },
  southern_mid_latitude: {
    regionHint: 'Southern hemisphere latitude band',
    pollen: {
      level: 'low',
      primaryType: 'grass',
      value: 8,
      unit: 'grains/m3',
    },
    uv: {
      index: 4,
      level: 'moderate',
    },
    airQuality: {
      aqi: 58,
      level: 'moderate',
      primaryPollutant: 'pm2.5',
    },
    temperature: {
      celsius: 16,
      feelsLike: 15,
    },
    humidity: {
      percent: 62,
    },
  },
  high_latitude: {
    regionHint: 'High latitude band',
    pollen: {
      level: 'low',
      primaryType: 'tree',
      value: 6,
      unit: 'grains/m3',
    },
    uv: {
      index: 3,
      level: 'moderate',
    },
    airQuality: {
      aqi: 42,
      level: 'good',
      primaryPollutant: null,
    },
    temperature: {
      celsius: 9,
      feelsLike: 7,
    },
    humidity: {
      percent: 68,
    },
  },
} satisfies Record<StaticEnvironmentRegionKey, StaticEnvironmentProfile>;

export function getStaticEnvironmentSnapshot(
  input: EnvironmentSnapshotLocationInput,
): EnvironmentSnapshotDto {
  const profile = STATIC_ENVIRONMENT_PROFILES[selectRegionKey(input)];

  return {
    dataSource: 'static',
    updatedAt: STATIC_ENVIRONMENT_UPDATED_AT,
    regionHint: profile.regionHint,
    pollen: { ...profile.pollen },
    uv: { ...profile.uv },
    airQuality: { ...profile.airQuality },
    temperature: { ...profile.temperature },
    humidity: { ...profile.humidity },
  };
}

function selectRegionKey(
  input: EnvironmentSnapshotLocationInput,
): StaticEnvironmentRegionKey {
  if (!hasCompleteCoordinates(input)) {
    return 'default';
  }

  if (isChinaTemperateBand(input.lat, input.lon)) {
    return 'china_temperate';
  }

  const absoluteLatitude = Math.abs(input.lat);
  if (absoluteLatitude < 23.5) {
    return 'tropical';
  }
  if (absoluteLatitude >= 55) {
    return 'high_latitude';
  }
  if (input.lat < 0) {
    return 'southern_mid_latitude';
  }
  return 'northern_mid_latitude';
}

function hasCompleteCoordinates(
  input: EnvironmentSnapshotLocationInput,
): input is Required<EnvironmentSnapshotLocationInput> {
  return (
    typeof input.lat === 'number' &&
    Number.isFinite(input.lat) &&
    typeof input.lon === 'number' &&
    Number.isFinite(input.lon)
  );
}

function isChinaTemperateBand(lat: number, lon: number): boolean {
  return lat >= 18 && lat <= 54 && lon >= 73 && lon <= 135;
}
