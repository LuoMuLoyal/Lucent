---
status: active
owner: backend
---

# legal-documents

## 模块意图

面向客户端的法定文档服务:公开只读当前生效文档,并由受权限保护的管理服务维护版本内容。

## 边界

- 管:法定文档的公开查询(控制器标记 `@Public()`),以及被 Admin 授权后对文档元数据/内容的更新、缓存失效和审计写入。
- 不管:管理员身份/权限与管理 API 路由(由 admin 模块负责);用户同意记录的落库(本模块
  无此模型)。

## 依赖方向

- imports:无业务模块依赖(独立只读模块)。
- 被引用:无(barrel 为空,仅由 app.module 注册)。

## 内部结构

- `services/documents.service.ts` — `LegalDocumentsService`:按 locale 组装
  生效文档列表与单篇内容,并负责更新后的公开读缓存失效。
- `services/admin.service.ts` — `LegalDocumentsAdminService`:管理端列表、更新、变更摘要审计。

## 测试承接

- `legal-documents.controller.spec.ts`
- `services/documents.service.spec.ts`
- `services/admin.service.spec.ts`
