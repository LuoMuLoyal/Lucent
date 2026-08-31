---
status: active
owner: backend
---

# legal-documents

## 模块意图

面向客户端的法定文档(隐私政策、用户协议等)只读服务:列出当前生效的文档
并按 locale 取内容,供 App 内展示与合规同意流程使用。

## 边界

- 管:法定文档的公开查询(控制器标记 `@Public()`)。
- 不管:文档内容的编写与版本管理(运营侧);用户同意记录的落库(本模块
  无此模型)。

## 依赖方向

- imports:无业务模块依赖(独立只读模块)。
- 被引用:无(barrel 为空,仅由 app.module 注册)。

## 内部结构

- `services/documents.service.ts` — `LegalDocumentsService`:按 locale 组装
  生效文档列表与单篇内容。

## 测试承接

- `legal-documents.controller.spec.ts`
- `services/documents.service.spec.ts`
