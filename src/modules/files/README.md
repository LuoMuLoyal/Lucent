---
status: active
owner: backend
---

# files

## 模块意图

客户端文件直传的最小入口:校验 MIME 类型与大小上限后,向对象存储后端请求
presigned 上传 URL,客户端绕过服务器直接上传。本模块无业务数据模型,只是
common 存储基础设施面向客户端的薄封装。

## 边界

- 管:`/files` 上传凭证签发(类型/大小校验、presigned PUT)。
- 不管:实际存储实现与对象键规则(common/storage);上传后文件的业务消费
  (daily-records 等模块各自处理)。

## 依赖方向

- imports:`AuthModule`(认证)、`StorageModule`(common barrel)。
- 被引用:无(barrel 为空,仅由 app.module 注册)。

## 内部结构

- `services/files.service.ts` — `FilesService`:校验客户端上传参数并生成
  presigned 上传结果;签名失败归为 DEPENDENCY_UNAVAILABLE,而非 500。

## 测试承接

- `files.controller.spec.ts`
- `services/files.service.spec.ts`
