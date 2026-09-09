# ADR-0018: 配置文件回退纯环境变量(YAML 层退役)

- **Status**: accepted
- **Date**: 2026-09-09
- **Deciders**: LuoMuLoyal

## Context

ADR-0015(2026-08-24)决定把非敏感运行时配置迁入 `config/` 嵌套 YAML(`default.yaml`
→ `<env>.yaml` → `<env>.local.yaml` 三层深合并 + Zod 校验),敏感值留在 `.env.*`。
该模型实际运行后逐步暴露运维复杂度:

- **多环境碎片**:新增环境(staging)需要新建 `config/staging.yaml`,否则只能用
  `NODE_ENV=production` 撞生产默认值;环境差异分散在 YAML 与 env var 两层,心智负担高。
- **双事实源**:同一配置项(如 S3 各 endpoint)既能在 YAML 设默认、又能被 env 覆盖,
  排查「为什么这台服务器值不一样」要同时看两处。
- **部署链路额外资产**:Dockerfile 需 `COPY config/`,nest-cli.json 需把 YAML 列入
  assets 复制到 dist,镜像体积与构建步骤多绕一层。
- **收益未兑现**:当初「嵌套结构可读」的收益,在服务化部署(Coolify env 面板)下无感;
  环境变量的分层能力(development/production/test 独立 `.env.*` + `.local` 覆盖)
  已经覆盖了 YAML 想解决的问题。

## Decision

**退役 YAML 配置层,全部运行时配置统一走环境变量**,非敏感值在代码内联默认值:

1. 删除 `config/default.yaml` / `config/development.yaml` / `config/test.yaml` /
   `config/production.yaml` 与 `src/config/yaml/` 目录（`yaml-loader.ts` 深合并 + Zod schema）。
2. 各 config service(`app` / `mail` / `jwt` / `llm` / `s3-storage` / `tencent-cos` /
   `jpush`)与业务消费者(prisma 慢查询阈值、metrics、slow-request、meal、fuzzy、
   verification、oauth state)改为 `process.env[EnvKey.X] ?? 默认值` 直接读取。
3. 默认值以字面量内联在服务代码中,与 `.env.production.example` 的 `# 注释` 一一对应,
   Zod env 校验层(`environment.validation.ts`)保留,负责敏感值与跨字段约束。
4. 环境差异沿用既有 env 分层:`.env.<NODE_ENV>` + `.env.<NODE_ENV>.local` + 服务化
   部署(Coolify)面板注入;生产镜像不再携带 `config/` 资产。

## Options Considered

| Option                                           | Pros                                          | Cons                                                                            |
| ------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------- |
| 保留 YAML,为 staging 新建 `config/staging.yaml`  | 环境默认值可版本化                            | 双事实源仍在;staging/生产差异继续两处同步;新增环境永远要加文件                  |
| 保留 YAML,staging 复用 production + env 覆盖差异 | 零改动                                        | 双事实源仍在;config 目录变成摆设,读者不知看哪                                   |
| 全部回退纯 env(**采纳**)                         | 单一事实源;默认值进 zod 与代码;部署少一层资产 | 非敏感配置不再集中声明,靠 `.env.production.example` 注释补可发现性;25+ 文件改动 |

## Consequences

- 配置事实源收敛到:代码内联默认值 + `.env.*`(模板含 `# 注释` 说明) + 服务化部署面板。
  排查配置差异只看一处。
- 新增环境(staging)不再需要建配置文件,差异全部走环境变量,与 Coolify 面板模型一致。
- 镜像与构建:删除 `COPY config/`、`nest-cli.json` 的 config assets 条目,镜像更小。
- 代价:非敏感配置默认值散落在各 config service 字面量,可发现性依赖
  `.env.production.example` 注释与 `docs/reference/environment-variables.md`;
  ADR-0015 标记 superseded。
