---
status: active
owner: backend
---

# testing-support

## 模块意图

仅在测试运行时注册的后门模块(`app.module` 的 `isTestRuntime` 条件挂载),
为 E2E/全栈测试准备确定性数据,免于在测试里编排完整业务流程。对外只有一个入口:
`POST /api/v1/testing/fullstack-e2e/record-lane/prepare`。

## 边界

- 管:共享密钥守卫下的测试支撑端点与夹具构造。
- 不管:单元测试工具(common/types 的 deep-mocked 等);任何生产可用能力
  ——生产与构建产物里整模块不注册(`isTestRuntime` 要求 `NODE_ENV=test`
  且进程从源码目录运行)。

## 契约与陷阱

- **不进 OpenAPI**:控制器标 `@ApiExcludeController()`,所以 openapi.json 里没有
  这个端点;它不是公开 API,别按契约文件找它。
- `@Public()` 只逃过全局 JWT 守卫,鉴权实际由 `TestingSharedSecretGuard` 承担:
  请求必须带 `x-testing-secret` 头,与 `TESTING_SHARED_SECRET` 做常量时间比较,
  不一致一律 403。
- `prepare` 在**一个事务内**幂等地备好全部前置:按 email 建/复用用户(强制
  `active` + 邮箱已验证)、等价的 credential 账号(密码用同一 `ARGON2_OPTIONS`
  哈希)、默认布尔用户设置,并清空该用户目标日期的日报与其附件;随后
  **删除该用户全部会话**。因此返回的是"已登出、可直接重新登录"的干净状态,
  不要指望它返回值里有任何登录态。
- 事务提交后还要删两条缓存(`loginFailureCacheKey`、`userSettingsCacheKey`)——
  Redis 里残留的登录失败计数或旧设置会让紧接着的登录/读取看到过期状态。

## 依赖方向

- imports:`PrismaModule`;取 `auth` 的 `ARGON2_OPTIONS` /
  `loginFailureCacheKey` 与 `user-settings` 的缓存键,保证夹具与真实流程同构
  (不要在这里另写一套哈希参数或键名)。
- 被引用:无(测试基座经 HTTP 调用其端点,不 import 本模块)。

## 内部结构

- `services/fixtures.service.ts` — `TestingSupportService`:`prepareFullstackRecordLane`
  的事务夹具构造。
- `guards/testing-shared-secret.guard.ts` — 共享密钥校验,拦截非测试流量。

## 测试承接

`testing-support.controller.spec.ts`、`guards/testing-shared-secret.guard.spec.ts`、
`services/fixtures.service.spec.ts`
