# ADR-0019: 集成阿里云 OSS 专用 SDK(ali-oss provider)

- **Status**: accepted
- **Date**: 2026-09-09
- **Deciders**: LuoMuLoyal

## Context

Lucent 的对象存储抽象(`ObjectStorageRuntime`,ADR-0014)最初只支持两个实现:
`tencent-cos`(生产)与 `s3`(开发 SeaweedFS)。用户计划把存储从腾讯云 COS
迁往阿里云 OSS,并希望使用 OSS 专用 SDK(`ali-oss`)而非 S3 兼容层。

权衡:

- OSS 的 S3 兼容接口可直接复用现有 `S3StorageRuntime`,零代码改动;
  但用户明确要集成专用 SDK,且专用 SDK 对 OSS 特性(签名、端点解析、
  阿里云内部网络、后续 STS/分片等)支持更完整。
- `cos-nodejs-sdk-v5` 维护放缓,`ali-oss` 更活跃;抽象层已把厂商差异
  隔离在 runtime 实现内,新增 provider 风险可控。

## Decision

在 `ObjectStorageRuntime` 抽象下新增 `AliyunOssStorageRuntime`
(`src/common/storage/aliyun-oss.runtime.ts`),`StorageModule` 根据
`STORAGE_PROVIDER=ali-oss` 绑定该实现:

1. 新增配置:`ALIYUN_OSS_ACCESS_KEY_ID` / `ALIYUN_OSS_ACCESS_KEY_SECRET` /
   `ALIYUN_OSS_BUCKET` / `ALIYUN_OSS_REGION`(默认 `oss-cn-hangzhou`) /
   `ALIYUN_OSS_ENDPOINT`(可选,覆盖 region 标准端点) /
   `ALIYUN_OSS_PUBLIC_BASE_URL` / 三个 expiry/size 键;默认值落 zod 校验层。
2. `ali-oss` 为 CJS 包且无内置类型,使用官方 `@types/ali-oss`(devDependency),
   与 `cos-nodejs-sdk-v5` 相同的 default-import 互操作模式。
3. 预签名 URL 用 `asyncSignatureUrl`(v6 全异步 API;`signatureUrl` 同步版
   已标 deprecated);`uploadBuffer` 用 `put(name, buffer, { headers })`。
4. 与 COS 一致,OSS 签名 URL 不区分 audience:external(client)与 internal
   (视觉模型)返回同一 URL,由日志告警提示;如需区分走 CDN 或桶策略。

### 不在范围内

- 不替换默认 provider(仍为 `s3`),不改生产 COS 凭据或桶。
- 不引入 STS 临时凭证、分片上传、生命周期规则。
- 不删除 `cos-nodejs-sdk-v5` 实现(仍可经 `STORAGE_PROVIDER=tencent-cos` 使用)。

## Options Considered

| Option                | Pros                             | Cons                                      |
| --------------------- | -------------------------------- | ----------------------------------------- |
| OSS S3 兼容层(零改动) | 复用 `S3StorageRuntime`,无新依赖 | 非 OSS 专用;签名/端点细节依赖 S3 语义     |
| 专用 SDK(**采纳**)    | OSS 原生特性与端点解析;维护活跃  | 新增依赖 + 类型声明;需新增 runtime 与测试 |
| 直接替换 COS 为 OSS   | 单一厂商                         | 破坏既有 tencent-cos 能力,超出当前需求    |

## Consequences

- `StorageProvider` 类型扩展为 `'tencent-cos' | 's3' | 'ali-oss'`;API 响应
  的 `provider` 字段可能出现 `'ali-oss'`,DTO description 已同步。
- 环境变量文档、`.env.*.example` 模板、ADR 与迁移日志均已更新。
- 生产切换到 OSS:`STORAGE_PROVIDER=ali-oss` + 填写 `ALIYUN_OSS_*` 即可,
  业务服务零改动(仍依赖 `ObjectStorageRuntime`)。
- `ali-oss` 为纯 CJS 且依赖树较旧(urllib/xml2js 等),若未来升级 7.x
  或转为 ESM 需按 TODO「ESM 遗留 CJS 依赖」口径复核。
