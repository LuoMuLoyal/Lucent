# Mine And Settings Contract

本文档保留 Mine/Settings 总览与用户设置。

子文档：

- [[app-info-contract]]
- [[data-export-contract]]

## Summary

This contract defines the Lucent API for Mine/Settings data that was previously
static or toast-only on the Luminous client. It covers user-owned settings,
app metadata, and data-export request status.

## Boundary

- **Lucent provides:** user settings storage, app metadata, and data-export
  request/status tracking.
- **Luminous consumes:** displays settings values, routes to real pages, shows
  contract-backed status for rows that were previously fake.
- **Device-local state stays local:** OS notification permission, local notification
  scheduling, theme preference, and language preference remain device-local.
  Lucent does NOT own or mirror these.
- **No paid or credentialed external services** are wired in this contract.

## Ownership Map

- **AI/privacy toggles** → `Server` — Persisted as user settings
- **Data sharing consent** → `Server` — Persisted as user settings
- **Theme mode / palette** → `Device` — SharedPreferences, not synced
- **Language preference** → `Device` — Also written through health-context locale
- **Notification permission** → `Device` — OS-level grant, not a server preference
- **Reminder scheduling** → `Device` — Local notification controller
- **App about metadata** → `Server` — Read from package/config, not hardcoded client
- **Data export request** → `Server` — Status plus first real report-PDF export flow

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

- Settings privacy rows should read from `GET /api/v1/user/settings` and write
  through `PATCH /api/v1/user/settings`.
- Assistant settings UI should also treat `GET /api/v1/user/assistant/capabilities`
  as the server source of truth for what is merely permitted vs truly executable.
- `assistantEnabled` and `assistantMemoryEnabled` are intentionally separate:
  turning on the assistant does not imply cross-conversation memory reuse.
- Settings reminder summary rows should read from device notification controller
  state, not from hardcoded "Enabled" labels.
- Export row should POST the desired export kind/format/range and show the latest status from GET.
- Report export UI should refresh latest status before opening a previously shown `downloadUrl`,
  because signed URLs expire.
- Help/about feedback and update checks should read from
  `GET /api/v1/public/app-info`; FAQ content stays in the client assets.
- Signed-out state must not call protected settings APIs; keep those rows
  disabled or labeled as sign-in-required.

## Health-Context Profile Extras

The `UserHealthProfile.extras` JSONB column stores sparse extension fields that
are promoted to top-level DTO properties in `UserHealthProfileDto`:

| Field                   | Storage key in extras   | DTO property             | Type             | Notes                             |
| ----------------------- | ----------------------- | ------------------------ | ---------------- | --------------------------------- |
| Weight (kg)             | `weightKg`              | `weightKg`               | `number \| null` | 1–500 integer; `null` clears      |
| Emergency contact name  | `emergencyContactName`  | `emergencyContact.name`  | `string \| null` | max 50 chars; `null`/empty clears |
| Emergency contact phone | `emergencyContactPhone` | `emergencyContact.phone` | `string \| null` | max 20 chars; `null`/empty clears |

**Write path:** `PATCH /api/v1/user/health-context/profile` accepts
`weightKg`, `emergencyContactName`, `emergencyContactPhone` as optional fields.
The `ProfileWriteService` performs a **deep merge** — it reads the existing
`extras` JSONB, sets or deletes only the specified keys, and writes back the
merged object. This prevents unrelated extras keys from being overwritten.

**Read path:** `UserHealthContextMapperService.toResponse` extracts these keys
from `extras` with type guards and surfaces them as top-level DTO properties.
The raw `extras` object is still returned alongside for forward compatibility.

## API Surface

### 1. User Settings

**Endpoints:**

```text
GET  /api/v1/user/settings
PATCH /api/v1/user/settings
```

Both require authentication (`Bearer` token).

**GET Response:** `UserSettingsDto`

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
  securityPin: {
    enabled: boolean; // whether a Security PIN is set
    lastChangedAt: string | null; // ISO-8601 of last PIN change
  };
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
after the update. Successful settings and Security PIN responses are direct resources;
they do not include a generic `{ code, message, data }` envelope. Empty successful
operations use `204 No Content` where applicable.

The same direct-resource rule applies to account, app-info, environment, and data-export response
DTOs in the generated OpenAPI contract.

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

### 2. Security PIN

**Endpoints:**

```text
POST /api/v1/settings/security-pin/enable
POST /api/v1/settings/security-pin/verify
POST /api/v1/settings/security-pin/change
POST /api/v1/settings/security-pin/disable
```

All require authentication. Enable/change/disable additionally require the user's current Security
PIN. If no PIN is set, `enable` only requires the desired new PIN.

**Request bodies:**

```typescript
interface EnableSecurityPinDto {
  pin: string; // 6-digit numeric
}

interface VerifySecurityPinDto {
  pin: string; // 6-digit numeric
}

interface ChangeSecurityPinDto {
  oldPin: string; // current 6-digit PIN
  newPin: string; // desired 6-digit PIN
}

interface DisableSecurityPinDto {
  pin: string; // current 6-digit PIN
}
```

**Verify response:** `SecurityPinElevationResponseDto`

```typescript
interface SecurityPinElevationResponseDto {
  elevationToken: string; // short-lived signed JWT
  expiresAt: string; // ISO-8601, 15 minutes after issuance
}
```

The elevation token proves a recent PIN verification. Clients must send it as `Bearer
<elevationToken>` in the `x-security-elevation` header when calling protected sensitive routes.

**Current behavior:**

- PINs are hashed with argon2id on the server; Lucent never stores the raw PIN.
- Enabling, changing, or disabling a PIN bumps the user's elevation version, invalidating previously
  issued elevation tokens.
- A disabled PIN removes the hash; re-enabling requires setting a new PIN from scratch.
- User queries in `UserService` and `SecurityPinService` use `prisma.nonDeleted` API (soft-delete-aware).
