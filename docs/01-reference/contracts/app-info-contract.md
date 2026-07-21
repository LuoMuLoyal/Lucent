# App Info Contract

本文件是 [[mine-settings-contract]] 拆分后的子文档。

相关子文档：

- [[support-resources-contract]]
- [[data-export-contract]]

### 4. App Info

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
}
```

Values are read from config or package.json at startup — no database.
