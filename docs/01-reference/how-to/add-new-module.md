---
status: active
owner: backend
quadrant: how-to
updated: 2026-08-02
---

# How-To: 新增 NestJS 模块

## 前置

- 本地 Docker stack 已运行（`pnpm dev:stack`）
- 数据库已迁移（`pnpm db:migrate`）
- 阅读 [[../architecture]] 了解模块结构约定

## 步骤

### 1. 创建模块目录

在 `src/modules/` 下新建模块目录，遵循 [[01-reference/toolchain]] 和 `AGENTS.md` 的 Module Subdirectory Whitelist：

```
src/modules/{module}/
├── dto/
│   └── index.ts          # Barrel export
├── services/
│   ├── {module}.service.ts
│   └── index.ts          # Barrel export
├── {module}.controller.ts
└── {module}.module.ts
```

### 2. 编写模块文件

- `@Module()` 装饰器声明 providers、controllers、imports、exports
- `@Controller()` 使用 bare resource path，前缀由 `AppModule` 的 `RouterModule` 集中配置
- Service 类以 `.service.ts` 结尾，必须 `@Injectable()`
- DTO 使用 `@ApiProperty` / `@ApiPropertyOptional` 标注，确保 OpenAPI 导出完整

### 3. 注册路由

在 `src/app.module.ts` 的 `RouterModule.register()` 中添加路由前缀映射：

```typescript
{
  path: 'api/v1/{module}',
  module: {Module},
}
```

用户级模块使用 `/api/v1/user/{module}` 前缀。

### 4. 迁移数据库（如需要）

```bash
pnpm prisma:migrate --name add_{module}_tables
pnpm prisma:generate
```

### 5. 验证

```bash
pnpm lint:check          # ESLint --max-warnings=0
pnpm typecheck           # 含 spec 和 test
pnpm build               # SWC 编译
pnpm test                # 单元测试
pnpm export:openapi      # 确认新端点出现在 OpenAPI 中
```

### 6. 更新文档

- 追加今日 `docs/02-logs/migration-log/YYYY-MM-DD.md` 条目
- 如模块引入了新公共合同，在 `docs/01-reference/contracts/` 下创建合同文件
- 如有重大架构决策，在 `docs/01-reference/adr/` 下创建 ADR
- 更新 `docs/doc-map.yaml` 添加代码→文档映射规则
