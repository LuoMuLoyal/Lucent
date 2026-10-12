# ADR-0023: 三机 Compose 部署模型(跨云公网 + 安全组收口)

- **Status**: accepted (supersedes 0017;决定 1/2 于 2026-10-12 修订为一机一文件)
- **Date**: 2026-10-02
- **Revised**: 2026-10-12
- **Deciders**: LuoMuLoyal

## Context

[ADR-0017](0017-coolify-deployment.md) 描述了「仓库 compose + Coolify 注册为 Docker Compose
Service + Coolify 自带 Traefik 接管域名与 TLS」的模型,并在其 2026-09-10 修订里把 staging
改为「宿主原生 PM2 + 自建 Traefik + 推送即部署」。该模型已**不再对应任何真实环境**:

- 三台机器上**都没有 Coolify**,也**都没有 Traefik**,`80`/`443` 无监听;
- 其中一台曾装过 Coolify,现已移除;
- 此前作为 staging 的那台**已改作图后端宿主**,不再承载 Lucent 应用。

实际形态是**三台机器各跑一份仓库内 compose,用 `docker compose up -d` 直接管理**。
形态细节见 `docs/reference/deployment.md`。

三台机器分属三家云,1:1 NAT(出口 IP == 公网 IP),**任两家之间都没有 VPC 对等连接**,
私网网段互不可达,因此所有跨机地址必须是公网地址。

> 🔒 本 ADR 只记录形态与取舍,**不写真实 IP、端口暴露矩阵与安全组规则**——
> 那些属运维信息,在服务器侧 `.env` 与私有运维笔记中维护,不入库(仓库可能公开)。

## Decision

1. **编排事实源仍是仓库**:`compose.yaml`(主站)、`compose.graph.yaml`(图后端机)、
   `compose.monitoring.yaml`(监控栈)、`compose.dev.yaml`(本地开发)。四份都在仓库里
   版本化,服务器上是它们的拷贝。
   `compose.staging.yaml` 与 staging 专属资产随本 ADR 退役删除。
   **`.env` 按机器拆成三份模板**:`.env.production.example`(主站)、
   `.env.graph.example`(图后端机)、`.env.monitoring.example`(监控机),
   服务器上各拷成自己那份 `.env`。

2. **一台机器 = 一份 compose,服务集即该机的全部服务**:

   | 机器             | 架构    | 工作目录                 | compose                   | 起的服务                                                    |
   | ---------------- | ------- | ------------------------ | ------------------------- | ----------------------------------------------------------- |
   | 主站(华为云)     | aarch64 | `/opt/lucent`            | `compose.yaml`            | `postgres` `redis` `app` `lightrag` `node-exporter`         |
   | 图后端机(腾讯云) | amd64   | `/opt/lucent-neo4j`      | `compose.graph.yaml`      | `neo4j` `semantica`                                         |
   | 监控机(阿里云)   | amd64   | `/opt/lucent-monitoring` | `compose.monitoring.yaml` | `victoriametrics` `grafana` `victorialogs` `victoriatraces` |

   `docker compose up -d`(不带服务名)起的就是该机应有的全部服务。
   `semantica` 不再需要 `profiles` 门控 —— 见下文修订说明。

3. **跨云通信一律走公网,方向决定安全组往哪边开**:
   - 主站 app → 图后端机 `8099`(semantica):应用主动调用 → 图后端机侧放行主站出口 IP
   - 主站 app → 监控机 `9428`/`10428`(日志/追踪):应用主动 push → 监控机侧放行主站出口 IP
   - 监控机 → 主站 `3000`/`9100`(指标抓取):监控机主动 pull → 主站侧放行监控机出口 IP

   跨机地址必须填**公网地址**。填内网地址会静默失败(不是连接拒绝,而是超时后
   各服务按自己的回落语义处理)。

4. **安全组是访问控制层,不是"聊胜于无"的兜底**。端口发布到 `0.0.0.0` 不等于对全网开放:
   云安全组按**来源 IP 白名单**收口,把某端口限定到指定 IP 后,其可达性等同于
   "只有该 IP 能连"。这是与"仅绑回环 + SSH 隧道"同一档的访问控制,区别只在审计面与
   多一层云厂商依赖。因此**不以"端口是否发布"判断暴露面,以"安全组放行了谁"判断**。

   原则(具体 IP 与规则清单不入库):
   - 对外入口只有 app 端口;`node-exporter` 只放行监控机出口 IP;
   - 数据与 sidecar 端口只放行运维 IP 与确实需要对端的来源 IP;
   - 监控栈端口只放行运维 IP。

5. **无反向代理、无域名、无 TLS**。`app` 直接发布 `3000`,入口是
   `http://<主站IP>:3000`;`PUBLIC_BASE_URL` 与 `CORS_ORIGIN` 按此配置。
   HTTP 明文是当前事实形态:客户端到服务端的流量未加密,凭证与令牌在传输中不设防。
   引入域名 + TLS 终止是独立的后续决策,不在本 ADR 范围。

6. **发布 = 在目标机器上 `docker compose up -d`**(镜像有新版本时
   `pull` 后 `up -d --force-recreate`);所有服务 `restart: unless-stopped`,
   主机重启后自动恢复,无需额外的进程管理器或平台 Agent。

7. **镜像来自发布者自有 registry**,tag 为 **`sha-<git sha 前 8 位>`(不含架构)**。
   一个 tag 指向 **multi-arch manifest list**(`release.yml` 用 **每架构原生构建**
   —— `ubuntu-24.04-arm` 对公开仓库免费 —— 再按 digest 合成),Docker 按目标平台
   自动选层,因此**换架构不必改 tag,只改 sha**。**不走 QEMU**:模拟环境下的工具链
   行为与原生不同(本项目实测 `prisma` 在 QEMU 下会 panic)。
   **镜像引用写在服务器的 `.env` 里**(`LUCENT_IMAGE` / `LUCENT_DB_IMAGE`),
   换版本即改这一处。**回滚 = 把镜像引用改回旧 `sha-` tag 再 `up -d`**,
   天然可回退;schema 不回退,破坏性迁移继续遵守 expand-contract。
   发布模型细节见 `.github/workflows/README.md`。

8. **配置是服务器上的 `.env`,不入库**。compose 的 `${VAR}` 插值与 app 的
   `env_file` 读同一份,已 gitignore;模板按机器分三份:`.env.production.example`
   (主站)、`.env.graph.example`(图后端机)、`.env.monitoring.example`(监控机)。
   变量清单见 [environment-variables.md](../environment-variables.md)。

9. **数据库迁移随容器启动自动执行**:`entrypoint.sh` 跑
   `prisma migrate deploy`,失败则容器不启动(不会带坏 schema 上线)。

## Revision 2026-10-12:一机一文件(决定 1 / 2 修订)

### Context

原决定 2 让主站与图后端机**共用一份 `compose.yaml`**,靠"显式服务名"决定起哪些。
这个形态有三个可测的代价:

1. **图库机必须凑齐主站的口令才能启动。** compose 会对**整个文件**做插值,
   于是只跑 `neo4j` + `semantica` 的图库机也必须有 `LUCENT_IMAGE` /
   `LUCENT_DB_IMAGE` / `POSTGRES_PASSWORD` / `REDIS_PASSWORD` 的值。
   实测(用只含图库变量的 `.env` 跑 `docker compose config`):

   ```
   error while interpolating services.app.image: required variable LUCENT_IMAGE is missing a value
   error while interpolating services.postgres.environment.POSTGRES_PASSWORD: required
   error while interpolating services.postgres.image: required variable LUCENT_DB_IMAGE is missing
   error while interpolating services.redis.command: required variable REDIS_PASSWORD is missing
   ```

   而 `docs/howto/deploy.md` §二 给图库机列的 `.env` 只有
   `NEO4J_PASSWORD` / `API_TOKEN` / `SEMANTICA_IMAGE` —— **照文档照做会在插值阶段
   直接失败**。要让它跑起来,就得把主站的生产口令复制到一台不需要它们的机器上。

2. **`profiles` 是拆分缺失的症状。** `semantica` 带 `profiles: ['semantica']`
   只是为了在同一份文件里让主站"别起它"——两个服务集挤在一起才需要这道闸。
3. **同步单位被人为放大。** 2026-10-05 的记录:服务器上的 `compose.yaml` 是旧副本,
   `TRUST_PROXY: 'true'` 仍在,限流可被伪造 XFF 绕过。共用文件时"同步 compose"
   意味着同步两台机器的并集,漏一处的概率与影响面都更大。

`.env` 同理:569 行的单一模板被三台机器共用,每台只用其中一部分,
模板里被迫写满条件说明("阿里云那台只需把这些抄过去")。

### Decision

按**机器边界**切分,而不是按服务类型切分:

- `compose.yaml` → 只描述主站:`postgres` `redis` `app` `lightrag` `node-exporter`
- `compose.graph.yaml`(新)→ 只描述图库机:`neo4j` `semantica`
- `compose.monitoring.yaml` 不变(本就只服务监控机)
- `compose.dev.yaml` 不变(本就只服务本地)
- `.env.production.example` → 主站;新增 `.env.graph.example` / `.env.monitoring.example`

**判断标准从"该起哪些服务"变成"该用哪个文件"**:每台机器 `docker compose up -d`
(不带服务名)起的就是它应有的全部服务。`profiles` 门控随拆分删除。

### Consequences

- 每台机器只读自己那份 `.env`,**口令不必跨机器复制**;图库机不再需要
  `LUCENT_IMAGE` / `LUCENT_DB_IMAGE` / `POSTGRES_PASSWORD` / `REDIS_PASSWORD`。
- 服务器上的同步单位从"两台机的并集"缩到"一台机",漏同步的影响面随之缩小。
- 文件数从 3 个 compose + 1 个 env 模板变成 4 个 compose + 3 个 env 模板 ——
  代价是多两个文件要维护;收益是每份文件都能**单独**用自己那台的变量解析通过。
- **部署时要换文件**:图库机从 `cp compose.yaml` 改为 `cp compose.graph.yaml`,
  `.env` 模板名同步换(见 docs/howto/deploy.md)。

## Options Considered

| Option                                      | Pros                                                                                | Cons                                                                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **三机各跑仓库 compose + 安全组限源(采纳)** | 组件最少、链路最短;编排可版本化、单一事实源;无平台依赖与额外控制面;安全组即访问控制 | 无域名/TLS;无平台面板查看与一键回滚;跨云跨公网,延迟与带宽受窄带宽限制;三台需各自维护 `.env`                       |
| 保留 Coolify(0017 原模型)                   | 面板可视、一键部署回滚、自带 Traefik 与证书                                         | 为一个后端背整套控制面;编排与配置散落 UI;三台跨三家云,控制面本身也要跨云通信;与「编排留仓库」的单一事实源目标冲突 |
| 恢复 staging 的宿主原生 PM2 + 自建 Traefik  | 组件少、推送即部署                                                                  | 需要域名与 DNS;PM2 是又一层进程管理器;与「容器化 + 镜像可回滚」不一致;实际已无此环境                              |
| 自建 Nginx/Traefik 反代 + 证书              | 有域名与 HTTPS                                                                      | 反代、证书续期、限流全部自维护(ADR-0017 正是为摆脱这些才引入 Coolify);当前无域名需求                              |

## Consequences

- **文档必须重写**:`docs/reference/deployment.md` 与 `docs/howto/deploy.md` 原以
  Coolify 面板与 PM2 为主,现按三机分述。ADR-0017 按只增不改保留原文,
  仅在其 Status 行标注被本 ADR 取代。
- **staging 资产退役**:staging 专用 compose、`.github/workflows/` 下的 staging workflow、
  `deploy/` 下的 PM2 进程配置与 Traefik 模板、以及对应的计划文件全部删除
  —— 它们描述的环境已不存在,留着只会让下一次「照文档操作」踩空。
- **镜像发布链路保留并强化**:CI 构建推送镜像的职责不变,只是消费者从
  「平台面板改 `LUCENT_IMAGE`」变成「服务器上改 `.env` 再 `up -d`」。
  workflow 随后按关注点拆为 `ci.yml` / `docker.yml` / `release.yml`
  (见 `.github/workflows/README.md`),并把 app 与 db 镜像都改为
  **双架构原生构建 + manifest 合并**,tag 规范化为 `sha-<sha8>`。
- **暴露面由安全组决定**:端口发布形态见各 compose;可达范围见安全组规则。
  **不要把 `node-exporter` 暴露给 `0.0.0.0/0`**,也不要让数据端口落到运维来源之外。
- **运维信息与仓库分离**:真实 IP、安全组规则、镜像仓库账号属运维信息,
  在服务器侧与私有笔记维护。**仓库文档只写形态与占位符**,因为仓库可能公开。
- **无 TLS 是明确的已知缺口**:HTTP 明文传输;`METRICS_USER`/`METRICS_PASSWORD`
  与各 sidecar 的 bearer token 在跨云公网上明文过线。补齐方式是域名 + TLS 终止,
  属独立决策。
- **跨云依赖是硬依赖**:图后端机或监控机任一不可达,英文侧 OAG / 日志 / 追踪
  相应降级(LightRAG 与主流程不受影响)。各服务的缺失语义按其自身实现。
- **多机 `.env` 仍是漂移源**:三份 `.env` 各机维护,新增变量要逐台补。监控机的
  `LUCENT_PUBLIC_HOST` 与主站的 `PUBLIC_BASE_URL` 是同一事实的两处表达,
  改 IP 时必须同步。按机器拆模板只消除"抄错/漏抄"这一类漂移,不消除
  "同一事实两处表达"这一类 —— 后者由跨机地址的物理必要性决定,见决定 3。

## Relationship to ADR-0017

ADR-0017 的**编排事实源留在仓库**这一核心主张被完整继承(决定 1),其
「CI 构建推送镜像、服务器拉取」的镜像链路也保留(决定 7)。被取代的是:
执行平台(Coolify → 各机 `docker compose`)、反向代理与 TLS(自带 Traefik →
无)、发布动词(面板 Pull & Restart → 命令行 `up -d`)、以及 staging 的独立模型
(宿主 PM2 + 自建 Traefik → 不再存在)。ADR-0017 按只增不改的约定保留原文。
