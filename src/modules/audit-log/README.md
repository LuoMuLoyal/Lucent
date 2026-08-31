---
status: active
owner: backend
---

# audit-log

## 模块意图

为全应用提供安全敏感操作(改密码、身份绑定、数据导出、管理员写入等)的统一
审计落点。作为 `@Global` 模块,任何 feature module 无需显式 import 即可注入
`AuditLogService`,保证审计写入方式全局一致。

## 边界

- 管:`audit_logs` 表的写入——`log()` 显式等待、`logFireAndForget()` 不阻塞
  请求路径。
- 不管:审计数据的查询/展示端点(当前不存在);业务操作本身的鉴权与执行
  (由调用方模块负责)。

## 依赖方向

- imports:`PrismaModule`(DI);不依赖任何业务模块。
- 被引用:barrel `../audit-log` 导出 `AuditLogService`,当前消费方为
  `account`、`assistant`、`data-export`。

## 内部结构

- `services/audit-log.service.ts` — `AuditLogService`:审计条目写入;已知
  Prisma 错误映射为 DomainFailure,fire-and-forget 失败仅记 warn 日志与失败
  指标,绝不向业务调用方传播异常。

## 测试承接

- `services/audit-log.service.spec.ts`
