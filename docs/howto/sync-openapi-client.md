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

### operationId 写在哪里

`operationId` 是端点自身的属性，**写在 handler 的 `@ApiOperation` 上**，不集中在任何映射文件里：

```ts
@Get('browser/register')
@ApiOperation({
  operationId: 'registerInBrowser',
  summary: 'Register (httpOnly cookie session)',
})
async register(...) {}
```

这样重命名 handler 与改 `operationId` 是同一次编辑、同一份 diff，也不再存在"查表 miss 就静默退回 `Controller_method`"这种失败模式——后者曾经发生过：同一能力原先存在两个名称（表里的废弃键 / 控制器手写键），实际生效的是手写的那份。

导出时有两道硬校验，任一不满足即 `exit 1`：

1. 每个导出的 operation 都必须有 `@ApiOperation({ operationId })`；
2. `src/` 里的每个 `operationId` 都必须唯一，且必须对得上一个真实导出的 operation（防止改名后留下死标注）。

所以新增端点时**必须**写 `operationId`；命名沿用 AIP-190/136 口径（动词开头、camelCase，如 `listDoseLogs`、`getAdminUser`）。

验证导出结果：

```bash
# 检查路径数和 schema 数是否合理
node -e "const s=require('./docs/reference/generated/openapi.json'); console.log('paths:', Object.keys(s.paths).length, 'schemas:', Object.keys(s.components.schemas).length)"
```

## Luminous 侧：再生 Dart 客户端

```bash
cd Luminous
dart run scripts/contract/bootstrap.dart
```

此脚本会：

1. 读取 `../Lucent/docs/reference/generated/openapi.json`
2. 用 `openapi-generator-cli`（`dart-dio` 生成器）生成 API 客户端和模型，
   并清空 `generated/lucent_api/lib/` 后重建精确镜像（合同侧删名/改名时不残留旧文件）
3. 运行 `build_runner` 生成 `.g.dart` 文件

验证生成结果：

```bash
flutter analyze
flutter test
```

如需仅验证合同同步（不实际再生）：

```bash
dart run scripts/contract/verify_openapi.dart
```

## 常见问题

- **生成后 `flutter analyze` 报错**：确认 Lucent 侧 `pnpm export:openapi` 成功，
  且新端点的响应 schema 已用 `registerResponseSchema` 登记（未登记时导出仍会通过，
  但客户端拿到的是 `Response<void>`）
- **nullable 字段丢失类型**：确保 zod schema 用 `.nullable()` 而非依赖推断
- **SSE 端点不匹配**：流式端点不走生成客户端，而是手动解析；确认
  `Luminous/lib/core/network/client/sse.dart` 与最新 schema 一致
- **过滤生成的模型清单失配**：`bootstrap.dart` 的 `_filteredClients` 清单用的是
  生成器解析出的**原始 schema 名**，写错会被静默忽略；脚本已用
  `_verifyFilteredModelsProduced` 做 fail-fast 校验

## 详细参考

- `Lucent/docs/howto/sync-openapi-client.md`（本文）
- `Luminous/docs/reference/openapi-client.md` — 生成物边界与使用规则
- `Lucent/docs/reference/generated/openapi.json` — API 合同唯一事实源（生成物，禁手改）
