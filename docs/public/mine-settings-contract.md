# Mine And Settings Contract

Last updated: 2026-06-18

## Summary

This contract defines the Lucent API for Mine/Settings data that was previously
static or toast-only on the Luminous client. It covers user-owned settings,
public support resources, app metadata, and data-export request status.

## Boundary

- **Lucent provides:** user settings storage, static support-resource reference
  data, app metadata, and data-export request/status tracking.
- **Luminous consumes:** displays settings values, routes to real pages, shows
  contract-backed status for rows that were previously fake.
- **Device-local state stays local:** OS notification permission, local notification
  scheduling, theme preference, and language preference remain device-local.
  Lucent does NOT own or mirror these.
- **No paid or credentialed external services** are wired in this contract.

## Ownership Map

| Setting / Resource                | Owner  | Notes                                          |
| --------------------------------- | ------ | ---------------------------------------------- |
| AI/privacy toggles                | Server | Persisted as user settings                     |
| Data sharing consent              | Server | Persisted as user settings                     |
| Theme mode / palette              | Device | SharedPreferences, not synced                  |
| Language preference               | Device | Also written through health-context locale     |
| Notification permission           | Device | OS-level grant, not a server preference        |
| Reminder scheduling               | Device | Local notification controller                  |
| Campus hospital / pharmacy / etc. | Server | Static reference data served from Lucent       |
| Help / FAQ content                | Server | Static reference data served from Lucent       |
| App about metadata                | Server | Read from package/config, not hardcoded client |
| Data export request               | Server | Status plus first real report-PDF export flow  |

## API Surface

### 1. User Settings

**Endpoints:**

```text
GET  /api/v1/user/settings
PATCH /api/v1/user/settings
```

Both require authentication (`Bearer` token).

**GET Response:** `{ code: 0, data: UserSettingsDto }`

```typescript
interface UserSettingsDto {
  aiSummariesEnabled: boolean; // allow AI-generated summaries/advice
  dataSharingConsent: boolean; // consent to share anonymized data for research
  assistantEnabled: boolean; // allow the user to use the assistant feature
  assistantMemoryEnabled: boolean; // allow cross-conversation assistant memory reuse
  assistantContext: {
    healthProfile: boolean; // allow the assistant to read profile/allergies/conditions
    dailyRecords: boolean; // allow the assistant to read recent daily records
    sleepRecords: boolean; // allow the assistant to read sleep records/summaries
    currentMedicines: boolean; // allow the assistant to read medicine-box/current medicines
  };
  updatedAt: string; // ISO-8601
}
```

**PATCH Body:**

```typescript
interface UpdateUserSettingsDto {
  aiSummariesEnabled?: boolean;
  dataSharingConsent?: boolean;
  assistantEnabled?: boolean;
  assistantMemoryEnabled?: boolean;
  assistantContext?: {
    healthProfile?: boolean;
    dailyRecords?: boolean;
    sleepRecords?: boolean;
    currentMedicines?: boolean;
  };
}
```

Partial update; omitted fields are not changed. Returns the full `UserSettingsDto`
after the update.

**Storage:** `UserSetting` Prisma model — one row per user per setting key.

Assistant-related persisted keys now use:

```text
assistantEnabled
assistantMemoryEnabled
assistantContext.healthProfile
assistantContext.dailyRecords
assistantContext.sleepRecords
assistantContext.currentMedicines
```

### 2. Support Resources

**Endpoint:** `GET /api/v1/public/support-resources?scope=campus`

Public (no authentication required). Returns a list of static reference entries.

**Query:**

| Param   | Type   | Required | Description                                               |
| ------- | ------ | -------- | --------------------------------------------------------- |
| `scope` | string | no       | Filter by scope: `campus`, `help`, `about`. Default: all. |

**Response:** `{ code: 0, data: SupportResourceListDto }`

```typescript
interface SupportResourceListDto {
  items: SupportResourceDto[];
  updatedAt: string; // ISO-8601, when reference data was last revised
}

interface SupportResourceDto {
  id: string; // stable identifier, e.g. "campus-hospital"
  scope: 'campus' | 'help' | 'about';
  title: string; // localized title (server-locale or key)
  titleKey: string | null; // client l10n key if available
  subtitle: string | null;
  subtitleKey: string | null;
  icon: string | null; // Material icon name hint
  actionUrl: string | null; // external URL if applicable
  actionType: 'url' | 'phone' | 'internal' | null;
  available: boolean; // false = resource not yet configured
}
```

**Initial reference data:** static TypeScript constants in the Lucent
`support-resources` module — no database migration required for this endpoint.
Entries marked `available: false` when no real contact/URL is configured.

### 3. App Info

**Endpoint:** `GET /api/v1/public/app-info`

Public (no authentication required). Returns application metadata.

**Response:** `{ code: 0, data: AppInfoDto }`

```typescript
interface AppInfoDto {
  name: string; // "Lucent"
  version: string; // from package.json
  description: string; // from package.json
  buildDate: string; // ISO-8601, build/publish timestamp
  minClientVersion: string | null; // minimum Luminous version hint
  supportEmail: string | null;
  privacyPolicyUrl: string | null;
  termsOfServiceUrl: string | null;
}
```

Values are read from config or package.json at startup — no database.

### 4. Data Export Requests

**Endpoints:**

```text
POST /api/v1/user/data-export-requests
GET  /api/v1/user/data-export-requests/latest
```

Both require authentication.

**POST Body:**

```typescript
interface CreateDataExportRequestDto {
  kind?: 'hospital' | 'monthly' | 'print';
  format?: 'pdf'; // only pdf is supported right now
  range?: 'last_7_days' | 'last_30_days';
}
```

**POST Response (201):** `{ code: 0, data: DataExportRequestDto }`

Lucent persists the request row first, then tries to generate the export immediately.
Current real implementations are:

- `hospital + pdf + last_7_days`
- `monthly + pdf + last_30_days`
- `print + pdf + last_7_days`

**GET Response:** `{ code: 0, data: DataExportRequestDto | null }`

Returns the most recent export request for the authenticated user, or `null`
if none exists.

```typescript
interface DataExportRequestDto {
  id: string;
  kind: 'hospital' | 'monthly' | 'print';
  format: 'pdf';
  range: 'last_7_days' | 'last_30_days';
  status: 'requested' | 'processing' | 'completed' | 'failed' | 'unavailable';
  requestedAt: string; // ISO-8601
  completedAt: string | null;
  downloadUrl: string | null; // short-lived signed GET URL when completed
  fileName: string | null;
  fileSizeBytes: number | null;
  errorMessage: string | null;
}
```

**Current behavior:**

- If Tencent COS export storage is not configured, POST still creates a row but
  returns status `unavailable`.
- If the export succeeds, Lucent uploads the PDF to COS, stores object metadata,
  and GET returns a short-lived signed download URL.
- `downloadUrl` should be treated as ephemeral; clients should refresh latest
  status before downloading again instead of caching the URL permanently.
- `monthly` requests are normalized to `last_30_days` before Lucent stores and generates the export, even if the caller passes another range value.

## Prisma Models

```prisma
model UserSetting {
  id        String   @id @default(uuid())
  userId    String   @map("user_id")
  key       String
  value     Json?    @db.JsonB
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, key])
  @@index([userId])
  @@map("user_settings")
}

model DataExportRequest {
  id            String    @id @default(uuid())
  userId        String    @map("user_id")
  kind          String
  format        String
  range         String
  status        String    @default("requested")
  objectKey     String?   @map("object_key")
  bucket        String?
  provider      String?
  fileName      String?   @map("file_name")
  fileSizeBytes Int?      @map("file_size_bytes")
  completedAt   DateTime? @map("completed_at") @db.Timestamptz(3)
  downloadUrl   String?   @map("download_url")
  errorMessage  String?   @map("error_message")
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt     DateTime  @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt])
  @@index([userId, kind, createdAt])
  @@map("data_export_requests")
}
```

## Explicit Non-Goals

1. **No docx export.** PDF only in the current slice.
2. **No paid external services** (counseling hotlines with paid APIs, etc.).
3. **No server-owned notification permission.** OS permission stays device-local.
4. **No server-owned theme/language preference.** Theme stays device-local;
   language stays in health-context locale.
5. **No real-time help/FAQ CMS.** Static reference data only.

## Luminous Integration Notes

- Mine campus services should read from `GET /api/v1/public/support-resources?scope=campus`
  instead of hardcoded entries.
- Settings privacy rows should read from `GET /api/v1/user/settings` and write
  through `PATCH /api/v1/user/settings`.
- Assistant settings UI should also treat `GET /api/v1/user/assistant/capabilities`
  as the server source of truth for what is merely permitted vs truly executable.
- `assistantEnabled` and `assistantMemoryEnabled` are intentionally separate:
  turning on the assistant does not imply cross-conversation memory reuse.
- Settings reminder summary rows should read from device notification controller
  state, not from hardcoded "Enabled" labels.
- Export row should POST the desired export kind/format/range and show the latest status from GET.
- Report export UI should refresh latest status before opening a previously shown `downloadUrl`, because signed URLs expire.
- Help/about rows should read from `GET /api/v1/public/support-resources?scope=help`
  and `GET /api/v1/public/app-info`.
- Signed-out state must not call protected settings APIs; keep those rows
  disabled or labeled as sign-in-required.
