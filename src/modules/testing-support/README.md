---
status: active
owner: backend
---

# testing-support

## 模块意图

仅在 `NODE_ENV=test` 注册的后门模块,为 E2E/全栈测试提供夹具:一键构造
用户、日报与登录态等确定性测试数据,免于在测试里编排完整业务流程。

## 边界

- 管:共享密钥守卫下的测试支撑端点与夹具构造。
- 不管:单元测试工具(common/types 的 deep-mocked 等);任何生产可用能力
  ——生产环境整模块不注册。

## 依赖方向

- imports:`PrismaModule`;经 app.module 条件挂载(`NODE_ENV === 'test'`)。
- 被引用:无(测试基座经 HTTP 调用其端点,不 import 本模块)。

## 内部结构

- `services/fixtures.service.ts` — `TestingSupportService`:构造/清理测试
  用户、日报与缓存等夹具。
- `guards/testing-shared-secret.guard.ts` — 共享密钥校验,拦截非测试流量。

## 测试承接

`testing-support.controller.spec.ts`、`guards/testing-shared-secret.guard.spec.ts`、
`services/fixtures.service.spec.ts`
