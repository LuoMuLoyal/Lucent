# 对象存储双环境：生产腾讯云 COS / 开发 SeaweedFS 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Created: 2026-08-16
Updated: 2026-08-17

> 状态：已复核，未执行。本文件是实施计划；完成后删除。长期架构决策记录到 ADR-0014。

**目标：** 让 Lucent 在开发环境使用本地 SeaweedFS 完成图片直传和 PDF 导出，同时保持生产、test/e2e 的腾讯云 COS SDK 与既有环境变量行为不变。

**架构：** 以可注入的 `ObjectStorageRuntime` 抽象隔离业务模块与厂商 SDK。`StorageModule` 根据 `STORAGE_PROVIDER` 提供腾讯 COS 或 S3 兼容实现；S3 实现分别维护内部操作、客户端预签名和外部可访问预签名三个端点，避免把 Android 模拟器地址误用于后端或远程视觉模型。

**技术栈：** NestJS 11、`cos-nodejs-sdk-v5`、AWS SDK v3 S3、SeaweedFS S3 API、Docker Compose、Vitest。

---

## 一、审核结论与边界

原方案方向成立，但以下事项已修正为实施前置条件：

1. 代码中真正注入 `CosStorageRuntime` 的只有 4 个消费方：`DailyRecordImageUploadService`、`FilesService`、`DataExportStorageService` 和 `MealAnalysisWorkerService`。`reports/clinic-summary/share` 与 `medicines/adapters/cn` 不使用对象存储，不能纳入改造范围。
2. `DailyRecordImageUploadDto`、附件 DTO 及生成的 OpenAPI 仍声明/描述为 COS；虽然字段形状不变，`provider` 可能返回 `s3`，因此必须更新 DTO 描述、执行 `pnpm export:openapi`，并运行 Luminous 的生成与同步检查。不能宣称“无需重生成 OpenAPI”。
3. `pnpm dev:stack` 的默认服务列表写死在 `scripts/dev/up-local-stack.ts`，只改 `docker-compose.dev.yml` 不会启动 SeaweedFS；两处都必须改。
4. 一个预签名 URL 只能签给一个主机名。`127.0.0.1`、`10.0.2.2` 和局域网 IP 不是可同时适用的默认值；客户端端点应按当前调试拓扑显式配置。后端内部端点不得复用客户端端点。
5. 餐食视觉模型接收的是 URL；若模型服务在开发机外，`127.0.0.1`、`10.0.2.2` 与局域网私有地址均不可达。本计划不把“纯本地 SeaweedFS + 云端视觉模型端到端成功”作为验收项；要验证该链路，须另行提供 `STORAGE_S3_EXTERNAL_ENDPOINT`（HTTPS 公网反向代理/隧道）并确认供应商可拉取该 URL。
6. SeaweedFS 使用真实 S3 鉴权：容器用 `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` 配置，Lucent 的 `STORAGE_S3_*` 使用同一对凭据。不得把“无鉴权”与有意义的 SigV4 预签名并列；匿名 S3 请求不提供签名所声称的访问控制或过期边界。
7. Filer `:8888/buckets/...` 直读会绕过 S3 网关和签名，只能作为本机开发期的图片显示便利。它必须绑定开发环境、明确风险，且不能用于生产或真实数据。

### 不在范围内

- 不替换生产 `cos-nodejs-sdk-v5`，不改生产 COS 凭据或桶。
- 不迁移 test/e2e 到 SeaweedFS；`NODE_ENV=test` 继续选择 `tencent-cos`。
- 不引入 STS、分片上传、对象生命周期规则或 Luminous 的业务逻辑改动。
- Android/Desktop 的 Dio 上传不需要 S3 CORS；只有要支持 Flutter Web 时，才另行设置桶 CORS 或 `-s3.allowedOrigins` 并加浏览器验证。

## 二、端点与配置合同

所有端点均为完整的 `http(s)` URL，S3 使用 path-style URL（`forcePathStyle: true`）。预签名 URL 必须由目标端点对应的 `S3Client` 生成，禁止在签名完成后替换 URL 主机。

| 用途                                | 环境变量                       | 使用者                 | Android 模拟器示例                        |
| ----------------------------------- | ------------------------------ | ---------------------- | ----------------------------------------- |
| 后端 S3 操作和桶探测                | `STORAGE_S3_ENDPOINT`          | API、PDF 上传          | `http://127.0.0.1:8333`                   |
| 发给当前客户端的预签名 PUT/GET      | `STORAGE_S3_CLIENT_ENDPOINT`   | Flutter/Dio            | `http://10.0.2.2:8333`                    |
| 发给远程服务的预签名 GET（可选）    | `STORAGE_S3_EXTERNAL_ENDPOINT` | meal-analysis 视觉模型 | `https://storage-dev.example.test`        |
| 静态显示 URL 的基址（仅本地匿名读） | `STORAGE_S3_PUBLIC_BASE_URL`   | Luminous 图片显示      | `http://10.0.2.2:8888/buckets/lucent-dev` |

新增 S3 专用变量：

```text
STORAGE_PROVIDER=tencent-cos|s3
STORAGE_S3_ENDPOINT=
STORAGE_S3_CLIENT_ENDPOINT=
STORAGE_S3_EXTERNAL_ENDPOINT=
STORAGE_S3_PUBLIC_BASE_URL=
STORAGE_S3_ACCESS_KEY=
STORAGE_S3_SECRET_KEY=
STORAGE_S3_BUCKET=
STORAGE_S3_REGION=us-east-1
```

保留既有 `TENCENT_COS_*` 键及其交叉校验，仅由 `tencent-cos` 实现读取。这样生产现有部署无迁移，也不会把 SeaweedFS 的桶、端点或占位凭据伪装成腾讯云配置。

`STORAGE_S3_CLIENT_ENDPOINT` 缺省时回退 `STORAGE_S3_ENDPOINT`；`STORAGE_S3_EXTERNAL_ENDPOINT` 不设时，S3 实现只支持内部和客户端 URL。`STORAGE_S3_PUBLIC_BASE_URL` 只有在本地 Filer 明确配置为匿名只读并通过真实 GET 验证后才能设置；否则返回 `null`，不得持久化未经验证的展示 URL。

官方核验来源和对应限制见同目录 `2026-08-16-object-storage-dev-seaweedfs-research.md`。

## 三、目标文件与职责

| 文件                                                          | 改动                                                             |
| ------------------------------------------------------------- | ---------------------------------------------------------------- |
| `src/common/storage/object-storage.runtime.ts`                | 抽象类、公共配置类型和 URL 受众类型，作为 Nest DI token。        |
| `src/common/storage/tencent-cos.runtime.ts`                   | 由现有 COS runtime 迁移而来，保留 COS SDK 调用和既有行为。       |
| `src/common/storage/s3.runtime.ts`                            | AWS SDK v3 的 SeaweedFS/S3 兼容实现、桶初始化、三类端点签名。    |
| `src/common/storage/storage.module.ts`                        | 依 `STORAGE_PROVIDER` 绑定抽象 token 到唯一的具体实现。          |
| `src/config/services/s3-storage.config.ts`                    | S3 专用已解析配置。                                              |
| `src/config/env/{env-keys.enum.ts,environment.validation.ts}` | S3 键、格式和 provider 相关交叉校验。                            |
| `src/app.module.ts`                                           | 注册 S3 配置 factory。                                           |
| 4 个现有消费方及其 spec                                       | 改注入 token、使用 runtime 的 provider/readiness；其余行为不变。 |
| 上传 DTO、OpenAPI、Luminous 生成客户端                        | 消除“当前仅 COS”的错误说明并同步契约产物。                       |
| `docker-compose.dev.yml`、`scripts/dev/up-local-stack.ts`     | 可重复启动带持久卷的 SeaweedFS。                                 |

## 四、实施任务

### Task 1：锁定 SeaweedFS 镜像、启动参数与 S3 身份配置

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `docker-compose.dev.yml`

- [ ] 使用 `chrislusf/seaweedfs:4.41`（2026-08-17 时官方 GitHub 最新 release）而非 `latest`；升级必须连同本计划的真实 S3 验收重新执行。
- [ ] 添加运行时依赖；S3 runtime 会被编译进 Nest 产物，不能放入 devDependencies：

```powershell
pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

- [ ] 以 `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` 将容器配置为鉴权 S3，并令 Lucent 使用同一对仅限本地开发的凭据。
- [ ] 服务命令包含 `weed server -dir=/data -s3 -master.port=9333 -volume.port=8080 -filer.port=8888 -s3.port=8333`，将 `/data` 挂到命名卷；没有 `-dir=/data` 的持久卷无效。
- [ ] 启动并确认 S3/Filer 端口均被服务发布；真实带签名 PUT/GET 在 Task 7 使用应用返回的 URL 验证：

```powershell
pnpm dev:stack seaweedfs
docker compose -f docker-compose.dev.yml ps seaweedfs
```

预期：服务状态为 running，且 `8333`、`8888` 均映射到宿主机；不把容器存活误当作 S3 兼容性验收。

### Task 2：先为存储抽象和 provider 选择写失败测试

**Files:**

- Create: `src/common/storage/object-storage.runtime.ts`
- Create: `src/common/storage/s3.runtime.spec.ts`
- Rename: `src/common/storage/cos-storage.runtime.spec.ts` → `src/common/storage/tencent-cos.runtime.spec.ts`
- Modify: `src/common/storage/storage.module.ts`
- Create: `src/common/storage/storage.module.spec.ts`

- [ ] 定义抽象 DI token 和精确的公共表面：

```ts
export type SignedUrlAudience = 'client' | 'external';

export abstract class ObjectStorageRuntime {
  abstract readonly provider: 'tencent-cos' | 's3';
  abstract getConfig(): ObjectStorageConfig;
  abstract isConfigured(): boolean;
  abstract createSignedPutUrl(input: SignedPutUrlInput): Promise<string>;
  abstract createSignedGetUrl(input: SignedGetUrlInput): Promise<string>;
  abstract uploadBuffer(input: UploadBufferInput): Promise<void>;
}
```

`SignedGetUrlInput` 必须包含 `audience: 'client' | 'external'`。COS 实现对两种受众生成既有 COS URL；S3 实现对 `external` 在缺少 `STORAGE_S3_EXTERNAL_ENDPOINT` 时抛出可识别的配置错误，不得悄悄回退到本机 URL。

- [ ] 写并运行失败测试，覆盖：默认选择 COS、`STORAGE_PROVIDER=s3` 选择 S3、未知 provider 在启动时失败、S3 PUT/GET 分别使用 client/external endpoint、桶不存在时仅创建一次、缺失 endpoint/凭据/bucket 时 `isConfigured()` 为 false。

```powershell
pnpm vitest run src/common/storage --reporter=verbose
```

预期：新测试在实现前失败于缺失抽象、provider factory 或 S3 runtime。

### Task 3：实现双 runtime 与可靠的桶初始化

**Files:**

- Rename: `src/common/storage/cos-storage.runtime.ts` → `src/common/storage/tencent-cos.runtime.ts`
- Create: `src/common/storage/s3.runtime.ts`
- Modify: `src/common/storage/storage.module.ts`
- Modify: `src/common/index.ts`

- [ ] 将 `CosStorageRuntime` 改名为 `TencentCosStorageRuntime`，实现 `ObjectStorageRuntime`。保留 `cos.getObjectUrl`、`cos.putObject` 的参数和现有过期语义；此任务不能改变腾讯云请求路径。
- [ ] `S3StorageRuntime` 使用 `S3Client`、`PutObjectCommand`、`GetObjectCommand`、`HeadBucketCommand` 和 `CreateBucketCommand`，所有 client 都使用 `forcePathStyle: true`。内部、客户端和外部签名使用各自 endpoint 的 client；服务端 `uploadBuffer` 始终使用内部 client。
- [ ] 将桶初始化写成 S3 runtime 上只会执行一次的 `ensureBucket()`：先 `HeadBucket`，只在明确的 not-found 响应时 `CreateBucket`；任何鉴权、网络或 5xx 错误必须原样失败，不能误判为不存在。
- [ ] `StorageModule` 以 `ObjectStorageRuntime` 作为唯一导出 token，并以 `STORAGE_PROVIDER` 选择一个具体 runtime。不要通过 TypeScript `interface` 注入，也不要同时注册两个可注入 runtime。
- [ ] 改完后运行 Task 2 的命令；预期：全部通过，且 COS spec 继续断言原 SDK 参数未变化。

### Task 4：配置注册与启动校验

**Files:**

- Create: `src/config/services/s3-storage.config.ts`
- Create: `src/config/services/s3-storage.config.spec.ts`
- Modify: `src/config/env/config-keys.enum.ts`
- Modify: `src/config/env/env-keys.enum.ts`
- Modify: `src/config/env/environment.validation.ts`
- Modify: `src/config/services/tencent-cos.config.ts`
- Modify: `src/config/services/tencent-cos.config.spec.ts`
- Modify: `src/app.module.ts`

- [ ] 为 S3 增加独立 `ConfigKey.S3Storage`；公共 `ObjectStorageConfig` 由两个 runtime 映射，业务服务不再读取 `TencentCosConfig`。
- [ ] 新增 Zod 规则：所有 endpoint/public base URL 必须是 `http(s)` URL；`STORAGE_PROVIDER` 只能为 `tencent-cos` 或 `s3`；当 provider 为 `s3` 时 endpoint、access key、secret key、bucket 必须同时存在；若配置 external endpoint，也必须是 URL。provider 为 COS 时继续执行原有 `TENCENT_COS_*` 成组校验。
- [ ] 保持 `STORAGE_PROVIDER` 未设置时选择 `tencent-cos`，使现有生产/test 配置不变；`.env.test` 不设 `STORAGE_PROVIDER`，因此 e2e 不触发 SeaweedFS。
- [ ] 运行配置单测和 typecheck：

```powershell
pnpm vitest run src/config/services/tencent-cos.config.spec.ts src/config/services/s3-storage.config.spec.ts
pnpm typecheck
```

预期：两个配置工厂的默认值、完整配置与不完整配置分支均受测试覆盖，TypeScript 无错误。

### Task 5：仅改造真实的四个消费方，并保留行为

**Files:**

- Modify: `src/modules/daily-records/services/image-upload.service.ts`
- Modify: `src/modules/files/services/files.service.ts`
- Modify: `src/modules/data-export/services/storage.service.ts`
- Modify: `src/modules/daily-records/services/meal-analysis/worker.service.ts`
- Modify: `src/modules/daily-records/daily-records.controller.ts`
- Modify: `src/modules/files/files.controller.ts`
- Modify: 对应 service/controller `*.spec.ts` 与受 mock 类型影响的 spec

- [ ] 所有构造函数改为 `@Inject(ObjectStorageRuntime) private readonly runtime: ObjectStorageRuntime`；mock 使用 `Pick<ObjectStorageRuntime, ...>`，不再伪造具体 COS 类。
- [ ] 两个上传服务和 PDF 服务从 `runtime.provider` 填充返回值，统一使用 `runtime.isConfigured()`；错误文案改为厂商无关的 `Object storage is not configured`。
- [ ] 图片直传仍仅签 `Content-Type`，返回 `headers: { 'Content-Type': contentType }`，并沿用现有 object-key 格式和大小限制。由于 AWS SDK v3 的 `getSignedUrl` 是异步的，两个 `createPresignedUpload` 方法与两个 controller action 必须改为 `async` 并 `await` 结果后再包入 `successEnvelope`；其 controller spec 同步改用 `mockResolvedValue` / `await`。S3 `publicUrl` 只来自经验证的 `STORAGE_S3_PUBLIC_BASE_URL`。
- [ ] PDF 下载使用 `createSignedGetUrl({ objectKey, audience: 'client' })`。餐食 worker 使用 `audience: 'external'`；本地未配置 external endpoint 时记录明确的可配置失败原因，不把无效本机 URL 交给远程模型。
- [ ] 运行受影响单测：

```powershell
pnpm vitest run src/common/storage src/modules/daily-records/services/image-upload.service.spec.ts src/modules/files/services/files.service.spec.ts src/modules/data-export/services/storage.service.spec.ts src/modules/daily-records/services/meal-analysis/worker.service.spec.ts
```

预期：COS 路径的 provider 和既有 URL 断言仍通过；新增 S3 mock 场景验证 provider、client endpoint 与 external-endpoint 缺失时的失败语义。

### Task 6：更新 API 描述并同步 Flutter 生成代码

**Files:**

- Modify: `src/modules/daily-records/dto/candidates/record-image-upload.dto.ts`
- Modify: `src/modules/daily-records/dto/record-attachment.dto.ts`
- Modify: `docs/openapi.json`（生成）
- Modify: `../Luminous` 中由生成脚本更新的客户端文件（仅生成结果）

- [ ] 将 `Signed PUT URL for direct COS upload` 与 `currently tencent-cos` 改为厂商中立描述；字段类型和 JSON 名称不变。
- [ ] 从 Lucent 执行生成，再从 Luminous 执行项目已有脚本：

```powershell
pnpm export:openapi
Set-Location ..\Luminous
dart run scripts/bootstrap_generated_sources.dart
dart run scripts/verify_lucent_openapi_sync.dart
```

预期：OpenAPI 反映 DTO 描述的变化；Luminous 的同步检查通过，手写 `record.dart` 不需要为 provider 添加分支。

### Task 7：接入本地开发栈并验证真实 S3 流程

**Files:**

- Modify: `docker-compose.dev.yml`
- Modify: `scripts/dev/up-local-stack.ts`
- Modify: `.env.development.example`
- Modify: `.env.development`（本地忽略文件，不能提交）

- [ ] 在 `up-local-stack.ts` 的默认 `targetServices` 中加入 `'seaweedfs'`，使 `pnpm dev:stack` 的语义与 README 一致。
- [ ] `.env.development.example` 提供桌面默认值（client endpoint 等于 `127.0.0.1`）和 Android 模拟器替换值（`10.0.2.2`）；不要把本机凭据或隧道 URL 提交到版本库。
- [ ] 执行端到端本机验证，使用 API 返回的真实 `uploadUrl`，而非手构 URL：

```powershell
pnpm dev:stack
pnpm start:dev
# 在另一终端：先经已认证 API 请求图片 presign，再用响应的 uploadUrl 与 headers 执行 PUT。
# 随后创建携带响应 objectKey/bucket/provider/publicUrl 的 daily record，并 GET 该 publicUrl。
```

预期：PUT 返回 2xx，记录包含 `provider: 's3'`，Filer public URL（若配置）返回上传内容；将 `STORAGE_S3_CLIENT_ENDPOINT` 改为 `10.0.2.2` 后，Android 模拟器完成相同 PUT。PDF 导出须验证服务端上传与客户端 signed GET；不配置 external endpoint 时餐食任务应以明确配置错误结束。

### Task 8：文档、ADR 与完整验证

**Files:**

- Create: `docs/01-reference/adr/0014-object-storage-provider-abstraction.md`
- Modify: `docs/01-reference/adr/README.md`
- Modify: `docs/01-reference/environment.md`
- Modify: `docs/01-reference/environment-variables.md`
- Modify: `README.md`
- Modify: `docs/02-logs/migration-log/2026-08-17.md`

- [ ] ADR 记录双 runtime、三端点职责、生产 COS 不迁移、SeaweedFS 仅限开发和 MinIO 回退条件。
- [ ] 环境文档写明 `pnpm dev:stack` 包含 SeaweedFS、Android/桌面端点切换、external endpoint 对云端视觉模型的要求，以及 Filer 匿名读仅限本地开发。
- [ ] 环境变量文档写明 COS 与 S3 的 provider 条件校验；README 更新本地栈说明。迁移日志追加实施范围与验证结论。
- [ ] 先运行项目规定的完整检查，再检查两仓库的 Git diff：

```powershell
Set-Location ..\Lucent
pnpm lint:check
pnpm typecheck
pnpm test
pnpm build
pnpm docs:check
pnpm export:openapi
Set-Location ..\Luminous
dart run scripts/bootstrap_generated_sources.dart
dart run scripts/verify_lucent_openapi_sync.dart
flutter analyze
git -C ..\Lucent diff --check
git -C ..\Luminous diff --check
```

预期：所有命令成功；只保留本计划列出的 Lucent 和生成的 Luminous 改动。确认 ADR、日志与环境文档已更新后，删除本计划文件。

## 五、验收矩阵

| 场景                 | 必须可观察到的结果                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------- |
| 生产 / test 默认配置 | `tencent-cos` 被注入；既有 COS 单测和 e2e 通过。                                              |
| 开发桌面端           | `pnpm dev:stack` 启动 SeaweedFS；API 返回 `provider: 's3'` 与 `127.0.0.1` 的 client PUT URL。 |
| Android 模拟器       | 设置 client/public base URL 为 `10.0.2.2` 后，Dio PUT 和图片显示均成功。                      |
| PDF 导出             | 后端用内部 endpoint 上传，客户端下载 URL 使用 client endpoint。                               |
| 餐食视觉             | 无 external endpoint 时有明确失败；配置真实 HTTPS 公网 endpoint 后才测试云端模型拉取。        |
| 回退                 | 将 `STORAGE_PROVIDER` 设为 `tencent-cos` 后，不需要改业务模块或 Luminous 代码。               |

## 六、风险与回退

| 风险                                    | 控制措施                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------- |
| SeaweedFS 与 AWS SDK 的预签名细节不兼容 | 先用 Task 1 的真实 S3 操作和 Task 7 的真实 presigned PUT 验证；失败时不合并，改评估 MinIO。 |
| 客户端使用错误网络地址                  | 区分 internal/client/external 三端点，端点按调试拓扑设置，不依赖自动猜测。                  |
| 本地对象被意外暴露                      | Filer 匿名读仅绑定本机开发用途；生产不启用 S3 provider 或该 public base URL。               |
| AWS SDK 引入影响生产                    | COS runtime、默认 provider 和生产 `TENCENT_COS_*` 保持不变；provider 选择由单测覆盖。       |

若 SeaweedFS 不能稳定通过真实 presigned PUT/GET 验收，保留抽象与 COS 实现，删除 SeaweedFS compose/S3 实现改动，改用 MinIO 的官方镜像与相同 `S3StorageRuntime` 合同重新验证；不得为兼容性问题改动生产 COS SDK。
