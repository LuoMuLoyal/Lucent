# Support Resources Contract

本文件是 [[mine-settings-contract]] 拆分后的子文档。

相关子文档：

- [[app-info-contract]]
- [[data-export-contract]]

### 3. Support Resources

**Endpoint:** `GET /api/v1/public/support-resources?scope=help`

Public (no authentication required). Returns a list of static reference entries.

**Query:**

- **`scope`** → `string` — no

**Response:** `{ code: 0, data: SupportResourceListDto }`

```typescript
interface SupportResourceListDto {
  items: SupportResourceDto[];
  updatedAt: string; // ISO-8601, when reference data was last revised
}

interface SupportResourceDto {
  id: string; // stable identifier, e.g. "help-faq"
  scope: 'help' | 'about';
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

The companion `GET /api/v1/public/app-info` endpoint returns `AppInfoDataDto` with
`minClientVersion`, `latestVersion`, `downloadUrl`, and `supportEmail` — all
sourced from environment variables. See [[app-info-contract]] for details.
