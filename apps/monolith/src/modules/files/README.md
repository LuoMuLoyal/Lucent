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
- 不管:实际存储实现(common/storage 的 `ObjectStorageRuntime`);上传后文件的
  业务消费(daily-records 等模块各自处理)。对象键虽由本模块调用
  `createFlatObjectKey` 生成,但键规则本身属 common。

## 依赖方向

- imports:`AuthModule`(认证)、`StorageModule`(common barrel)。
- 被引用:无(barrel 为空,仅由 app.module 注册)。

## 内部结构

- `services/files.service.ts` — `FilesService`:校验客户端上传参数并生成
  presigned 上传结果;签名失败按错误形态归为 `DEPENDENCY_TIMEOUT` 或
  `DEPENDENCY_UNAVAILABLE`,而非 500。原始错误只进 `cause`(日志/OTel),
  绝不进响应体。
- `dto/create-file-upload.dto.ts` — 请求 schema 与**响应 schema**
  (`createFileUploadResponseSchema`)。响应 schema 必须由 controller 底部的
  `registerResponseSchema` 注册进 OpenAPI,生成客户端才拿得到类型化响应体;漏注册时
  200 无 `content`,客户端方法退化为空 body。

## 不变量与陷阱

- 只放行 `ALLOWED_IMAGE_TYPES`(`common/constants/mime-types.ts`)内的图片
  MIME,大小上限取对象存储运行时配置的 `maxUploadBytes`,两者任一不满足都是
  `VALIDATION_FAILED`(400),不区分是哪个条件失败。
- 对象键由 `createFlatObjectKey('files', userId, ext)` 生成并扁平化,
  不含用户可控路径段;扩展名在 `image/jpeg` 时强制 `.jpg`。

## 测试承接

- `files.controller.spec.ts`
- `services/files.service.spec.ts`
