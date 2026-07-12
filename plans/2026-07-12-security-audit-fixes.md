# Lucent 安全审查修复计划

来源：2026-07-12 Luminous + Lucent 联合安全性审查。

## P0 — 高危，立即修复

### 1. 导出任务状态查询 IDOR

- **文件**: `src/modules/reports/reports.controller.ts` — `exportClinicSummaryPdfStatus()` / `generateSummaryStatus()`
- **问题**: 接受 `jobId` 但不校验 job 归属，任何已认证用户可查询他人导出状态并获取含健康数据的 PDF。
- **方案**:
  1. `ClinicSummaryPdfQueueService.getStatus()` 和 `ReportSummaryQueueService.getStatus()` 增加 `userId` 参数。
  2. 从 BullMQ job `data` 中读取 `userId`，与传入 `userId` 比对；不匹配返回 `null`。
  3. Controller 层传入 `@CurrentUser() user.sub`。
- **验证**: e2e 测试覆盖「跨用户查询 job → 返回 not_found」。

### 2. `/metrics` 端点无认证

- **文件**: `src/setup-app.ts` 第 36-39 行
- **问题**: Prometheus metrics 绕过所有 NestJS 守卫，暴露运行时指标。
- **方案**: 在 Express 路由中添加 Basic Auth 或静态 token 校验。
  ```typescript
  app.use('/metrics', basicAuth({ users: { [metricsUser]: metricsPass } }), async (_req, res) => { ... });
  ```
  或仅依赖 Nginx `allow/deny` 限制内网。两者择一，推荐 Express 层校验以覆盖非 Nginx 场景。
- **验证**: 未认证请求返回 401。

### 3. 未使用 Helmet

- **文件**: `src/setup-app.ts` / `src/main.ts`
- **问题**: 仅依赖 Nginx 提供安全头，开发或绕过 Nginx 时无安全头。
- **方案**:
  1. `pnpm add helmet`
  2. `setupApp` 中 `app.use(helmet())`，在 `enableCors` 之前。
- **验证**: `curl -I http://localhost:3000/api/v1/health` 确认安全头存在。

### 4. `/api/docs` 生产环境可访问

- **文件**: `src/setup-app.ts` 第 88-95 行
- **问题**: API 文档在所有环境公开，暴露完整 API 结构。
- **方案**: 环境判断，仅非生产注册。
  ```typescript
  if (configService.get<string>('NODE_ENV') !== 'production') {
    app.use('/api/docs', apiReference({ ... }));
  }
  ```
- **验证**: 生产环境 `GET /api/docs` 返回 404。

### 5. 测试支持端点缺少认证守卫

- **文件**: `src/modules/testing-support/testing-support.controller.ts`
- **问题**: 虽然仅在 `NODE_ENV=test` 加载，但无任何认证守卫，配置错误时风险极大。
- **方案**: 添加 `@UseGuards(JwtAuthGuard)` + 一个环境共享密钥 header 校验。
  ```typescript
  @UseGuards(JwtAuthGuard, TestingSharedSecretGuard)
  ```
- **验证**: e2e 测试覆盖「无 token → 401」「密钥错误 → 403」。

## P1 — 中危，短期修复

### 6. Admin 面板明文比较时序攻击

- **文件**: `src/admin/services/auth-router.service.ts` 第 34-36 行
- **问题**: `email === adminEmail && password === adminPassword` 存在时序侧信道。
- **方案**: 使用 `crypto.timingSafeEqual` 做常量时间比较。
  ```typescript
  import { timingSafeEqual } from 'node:crypto';
  function safeCompare(a: string, b: string): boolean {
    const ab = Buffer.from(a),
      bb = Buffer.from(b);
    return ab.length === bb.length && timingSafeEqual(ab, bb);
  }
  ```
- **验证**: 单元测试覆盖匹配/不匹配。

### 7. JWT Secret 无最小长度校验

- **文件**: `src/config/environment.validation.ts` 第 157-158 行
- **问题**: 弱密钥降低 HS512 安全性。
- **方案**: Joi 添加 `.min(32)`。
  ```typescript
  [EnvKey.JWT_ACCESS_SECRET]: Joi.string().min(32).required(),
  [EnvKey.JWT_REFRESH_SECRET]: Joi.string().min(32).required(),
  ```
- **验证**: 短 secret 启动时报错；更新 `.env.*.example` 注释。

### 8. 诊所摘要分享 Token 强度与存储

- **文件**: `src/modules/reports/services/clinic-summary/summary.service.ts`
- **问题**: 128 位 token，明文缓存。
- **方案**:
  1. `randomBytes(16)` → `randomBytes(32)`。
  2. 缓存中存储 SHA-256 哈希，`getSharedSummary` 也按哈希查询。
- **验证**: 单元测试覆盖创建/查询/过期。

### 9. 无 Redis 限流退化为单实例

- **文件**: `src/config/cache.config.ts` / `src/app.module.ts`
- **问题**: 多实例无 Redis 时暴力破解防护失效。
- **方案**: 生产环境启动时检查 `REDIS_URL`，未配置则拒绝启动并输出明确错误。
  ```typescript
  if (env === 'production' && !process.env.REDIS_URL) {
    throw new Error(
      'REDIS_URL is required in production for distributed rate limiting',
    );
  }
  ```
- **验证**: 无 `REDIS_URL` 启动生产环境时报错。

## P2 — 低危，择机修复

### 10. 验证码明文存储

- **文件**: `src/modules/auth/services/verification-code.service.ts` 第 102 行
- **方案**: 缓存中存储 `SHA-256(code)`，`verify` 时比较哈希。

### 11. Refresh Token 轮换非原子

- **文件**: `src/modules/auth/services/token.service.ts` 第 117-123 行
- **方案**: 评估是否用数据库事务包裹生成+删除，或在生成前先标记旧 session 为 `replacing`。当前设计已注释接受此风险，可在后续迭代中改进。

### 12. 开发环境 CORS 通配符

- **文件**: `.env.development.example`
- **方案**: 改为 `CORS_ORIGIN=http://localhost:3000,http://localhost:8080`。

### 13. `TRUST_PROXY` 测试环境默认开启

- **文件**: `src/config/app.config.ts` 第 29 行
- **方案**: 移除 `env === 'test'` 自动开启逻辑，仅显式 `TRUST_PROXY=true` 时生效。
