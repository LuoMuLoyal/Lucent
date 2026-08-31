# ADR-0014: Object Storage Provider Abstraction

- **Status**: accepted
- **Date**: 2026-08-17
- **Deciders**: Lucent backend team

## Context

Lucent 原先直接将 `cos-nodejs-sdk-v5` 注入到 4 个业务服务中
（`DailyRecordImageUploadService`、`FilesService`、`DataExportStorageService`、
`MealAnalysisWorkerService`），且 provider 硬编码为 `'tencent-cos'`。
开发环境无法在本地完成图片直传和 PDF 导出端到端调试，必须依赖云端
COS 桶和凭据。

## Decision

引入 `ObjectStorageRuntime` 抽象类作为唯一 DI token，
`StorageModule` 根据 `STORAGE_PROVIDER` 环境变量绑定唯一具体实现：

- `tencent-cos`（默认）→ `TencentCosStorageRuntime`，保留既有 COS SDK 调用。
- `s3` → `S3StorageRuntime`，使用 AWS SDK v3 对接 SeaweedFS S3 API。

S3 实现维护三个 `S3Client` 实例，分别对应：

- **internal** — 后端操作（`uploadBuffer`、`HeadBucket`、`CreateBucket`）
- **client** — 返回给 Flutter 客户端的 presigned PUT/GET URL
- **external**（可选）— 发给远程服务（如视觉模型）的 presigned GET URL

### 不在范围内

- 不替换生产 `cos-nodejs-sdk-v5`，不改生产 COS 凭据或桶。
- 不迁移 test/e2e 到 SeaweedFS；`NODE_ENV=test` 继续选择 `tencent-cos`。
- 不引入 STS、分片上传、对象生命周期规则。

## Options Considered

| Option               | Pros                          | Cons                              |
| -------------------- | ----------------------------- | --------------------------------- |
| 直接在业务服务中分支 | 无新抽象                      | 厂商耦合扩散到 4 个服务，难以测试 |
| 抽象 + 双 runtime    | 单一注入点，mock 简单，可扩展 | 新增 AWS SDK v3 运行时依赖        |
| 仅 S3 替换 COS       | 统一技术栈                    | 生产迁移风险高，超出当前需求      |

## Consequences

- 业务服务通过 `@Inject(ObjectStorageRuntime)` 获取厂商无关的存储能力，
  返回值中的 `provider` 字段由 runtime 填充。
- `createSignedPutUrl` / `createSignedGetUrl` 变为 `async`（AWS SDK v3
  的 `getSignedUrl` 是异步的），消费方和 controller 均已适配。
- SeaweedFS 仅限开发环境；生产不启用 S3 provider。
- 若 SeaweedFS 不能稳定通过真实 presigned PUT/GET 验收，保留抽象与 COS
  实现，改用 MinIO 的相同 `S3StorageRuntime` 合同重新验证。
