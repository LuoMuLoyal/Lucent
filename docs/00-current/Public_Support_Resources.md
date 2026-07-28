# Public Support Resources

Last updated: 2026-07-28

- `GET /api/v1/public/support-resources` now only serves `help` / `about` reference entries.
- Campus-scoped support resources have been removed from the active public contract because the
  project does not have a reliable school-specific data source.
- `help-feedback` 条目保持静态列表状态（`available: false`）。Luminous 客户端帮助页面已改为前端自包含：
  FAQ 内容由本地 Markdown 文件（`assets/faq/faq_{zh,en}.md`）提供，反馈入口通过前端环境变量
  `SUPPORT_EMAIL` 直接构造 `mailto:` URI，不再依赖后端动态注入。

## Legal Documents API

- `GET /api/v1/legal-documents` — list all active legal documents (metadata only)
- `GET /api/v1/legal-documents/:docType` — get a specific document with Markdown content
- `?lang=zh|en` query parameter controls title/content language (default: `zh`)
- Valid `docType` values: `terms`, `privacy`, `disclaimer`, `minor-protection`, `sdk-list`,
  `permissions`, `account-cancellation`
- Content stored in `legal_documents` table, manageable via AdminJS panel at `/admin`
- Placeholder Markdown content inserted via migration; pending legal review before production
