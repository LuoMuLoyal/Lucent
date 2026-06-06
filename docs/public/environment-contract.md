# Environment Snapshot Contract

Last updated: 2026-06-06

## Summary

This contract defines the Lucent API for environment data (pollen, UV, air quality)
that powers the More → Environment section and Today → Environment card.
This is the first real-contract path for the More module, selected because it
requires no external platform credentials (data can be seeded from static
reference tables or optional free-tier APIs).

## Boundary

- **Lucent provides:** environment snapshot data via API.
- **Luminous displays:** the data; does NOT compute or source it independently.
- **Data source:** initially static reference data bundled with Lucent; later
  replaceable with external API integration behind the same contract.
- **No external credentials required:** the initial implementation uses
  static seasonal reference tables, not third-party API keys.

## API Surface

### 1. Environment Snapshot

**Endpoint:** `GET /api/v1/environment/snapshot`

Returns the current environment indicators for the user's approximate region.
No user authentication required (public read). Location is optional; if omitted,
returns a default region's data.

**Request:**

| Param | Type   | Required | Description            |
| ----- | ------ | -------- | ---------------------- |
| `lat` | number | no       | Latitude, approximate  |
| `lon` | number | no       | Longitude, approximate |

**Response envelope:** `{ code: 0, data: EnvironmentSnapshotDto }`

```typescript
interface EnvironmentSnapshotDto {
  pollen: PollenIndicator;
  uv: UvIndicator;
  airQuality: AirQualityIndicator;
  temperature: TemperatureIndicator;
  humidity: HumidityIndicator;
  updatedAt: string; // ISO-8601, when the data was last refreshed
  dataSource: 'static' | 'live'; // static = reference tables, live = external API
  regionHint: string | null; // human-readable region name, or null
}

interface PollenIndicator {
  level: 'low' | 'medium' | 'high';
  primaryType: string | null; // e.g. 'tree', 'grass', 'ragweed'
  value: number | null; // raw measurement if available
  unit: string | null; // e.g. 'grains/m³'
}

interface UvIndicator {
  index: number; // 0-11+
  level: 'low' | 'moderate' | 'high' | 'very_high' | 'extreme';
}

interface AirQualityIndicator {
  aqi: number; // 0-500
  level:
    | 'good'
    | 'moderate'
    | 'unhealthy_sensitive'
    | 'unhealthy'
    | 'very_unhealthy'
    | 'hazardous';
  primaryPollutant: string | null; // e.g. 'pm2.5', 'o3'
}

interface TemperatureIndicator {
  celsius: number;
  feelsLike: number;
}

interface HumidityIndicator {
  percent: number;
}
```

### 2. Environment Advice (optional, future)

**Endpoint:** `GET /api/v1/environment/advice?lat=&lon=`

Returns contextual health advice based on current environment conditions.
May return null when advice is not available.

```typescript
interface EnvironmentAdviceDto {
  pollenAdvice: string | null; // localized advice text
  uvAdvice: string | null;
  airQualityAdvice: string | null;
  generalAdvice: string | null;
  updatedAt: string;
}
```

## Static Reference Implementation

The initial implementation uses static seasonal reference tables bundled with Lucent:

- **Pollen:** monthly averages per region from historical data
- **UV:** seasonal averages based on latitude band
- **Air Quality:** fixed "moderate" default (no live data)
- **Temperature/Humidity:** seasonal averages per latitude band

These tables are stored as JSON or TypeScript constants in Lucent's environment
module — no database migration required for Phase A.

When `dataSource` is `'static'`, the frontend should display a note that
data is approximate and not real-time. The Lumi card on Today already shows
a "预览" badge; the More environment section will show a "参考值" / "Reference" label.

## Explicit Non-Goals

1. **No real-time weather API integration.** External weather services (OpenWeatherMap, AccuWeather, etc.) require API keys and paid tiers. Not in scope.
2. **No user location tracking.** The `lat`/`lon` params are optional and approximate. Lucent does NOT store or track user location.
3. **No health diagnosis or medical advice.** Environment data is informational only.
4. **No push alerts for environment changes.** This would require the notification infrastructure defined in `reminder-contract.md`.
5. **No historical environment data API.** Only current snapshot is provided.

## Migration Path

1. **Phase A (Task 13 — this doc):** Contract design and review.
2. **Phase B (implemented 2026-06-06):** Static reference data + `GET /api/v1/environment/snapshot` in Lucent.
3. **Phase C (next):** Luminous swaps mock environment data for real API.
4. **Phase D (future):** Optional external API integration behind same contract.

## Luminous Integration Notes

- Currently More → Environment renders static mock data from `MoreDashboard.environment`.
- Luminous should create an `EnvironmentRepository` that calls `GET /api/v1/environment/snapshot`.
- When `dataSource` is `'static'`, the frontend should show a "参考值" badge (similar to Today's "预览" badge).
- When the API is unavailable, fall back to the existing static mock dashboard.
