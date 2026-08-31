---
status: active
owner: backend
quadrant: howto
updated: 2026-08-31
---

# How-To: 导出 OpenAPI 并再生 Flutter 客户端

## 前置

- Lucent 可正常 `pnpm build`
- Prisma client 已生成（`pnpm prisma:generate`）
- 如在 Luminous 侧操作，确认 `../Lucent/docs/reference/generated/openapi.json` 路径可达

## Lucent 侧：导出 OpenAPI

```bash
cd Lucent
pnpm export:openapi
```

此命令会先 `pnpm build`，然后导出 `docs/reference/generated/openapi.json`。该文件已跟踪在 git 中（标记为 `linguist-generated`），不手动编辑。API 变更后重新导出并提交。

验证导出结果：

```bash
# 检查路径数和 schema 数是否合理
node -e "const s=require('./docs/reference/generated/openapi.json'); console.log('paths:', Object.keys(s.paths).length, 'schemas:', Object.keys(s.components.schemas).length)"
```

## Luminous 侧：再生 Dart 客户端

```bash
cd Luminous
dart run tool/bootstrap_generated_sources.dart
```

此脚本会：

1. 读取 `../Lucent/docs/reference/generated/openapi.json`
2. 使用 `openapi_retrofit_generator` 生成 Retrofit API 客户端和 JSON-serializable 模型
3. 运行 `build_runner` 生成 `.g.dart` 文件

验证生成结果：

```bash
flutter analyze
flutter test
```

如需仅验证合同同步（不实际再生）：

```bash
dart run tool/verify_lucent_openapi_sync.dart \
  --openapi /absolute/path/to/Lucent/docs/reference/generated/openapi.json
```

## 常见问题

- **生成后 `flutter analyze` 报错**：确认 Lucent 侧 `pnpm export:openapi` 成功且无 DTO 缺失 `@ApiProperty` 标注
- **nullable 字段丢失类型**：确保 DTO 使用 `@ApiPropertyOptional` 或显式 `type` 注解，不依赖推断
- **SSE 端点不匹配**：流式端点使用手动 Dio + SSE 解析，不走生成客户端，确认 `lib/core/network/sse.dart` 手动解析逻辑与最新 DTO 一致

## 详细参考

- `Lucent/docs/howto/sync-openapi-client.md`（本文）
- `Luminous/docs/reference/OpenApi_Client.md` — 生成物边界与使用规则
- `Lucent/docs/reference/generated/openapi.json` — API 合同唯一事实源（生成物，禁手改）
