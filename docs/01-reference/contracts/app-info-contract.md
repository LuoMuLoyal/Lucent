# App Info Contract

本文件是 [[mine-settings-contract]] 拆分后的子文档。

相关子文档：

- [[support-resources-contract]]
- [[data-export-contract]]

### 4. App Info

**Endpoint:** `GET /api/v1/public/app-info`

Public (no authentication required). Returns server-side runtime configuration
for the client. App name, version, and build number are **not** included —
the client obtains those locally via `package_info_plus`.

**Response:** `{ code: 0, data: AppInfoDto }`

```typescript
interface AppInfoDto {
  minClientVersion: string | null; // minimum Luminous version hint
  latestVersion: string | null; // latest available client version
  downloadUrl: string | null; // update / download page URL
  supportEmail: string | null; // support contact email for About page
}
```

Values are read from environment variables (`SUPPORT_EMAIL`,
`MIN_CLIENT_VERSION`, `LATEST_VERSION`, `DOWNLOAD_URL`) at startup — no
database, no `package.json`.
