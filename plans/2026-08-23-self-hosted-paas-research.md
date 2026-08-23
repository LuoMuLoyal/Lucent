---
status: active
owner: backend
quadrant: reference
updated: 2026-08-23
---

# Lucent 自托管 PaaS 调研（Coolify / Dokploy / 其他）+ Nginx → Traefik 评估

> 调研日期：2026-08-23（Asia/Shanghai）。
>
> 目标：评估把 Lucent 当前「Docker Compose 单机部署 + Nginx 反代 + GitHub Actions/TCR/SSH 部署链」
> 迁移到自托管 PaaS（子托管 PaaS，self-hosted PaaS），并把 Nginx 换成 Traefik，选出一个适合
> Lucent 的候选。本文是调研与选型文档，不含实施改动；实施前应另起 plan 并写 ADR。

## 参考来源（2026-08 检索）

### 综合对比

- [Best Self-Hosted PaaS to Replace Heroku in 2026 (Contabo)](https://contabo.com/blog/self-hosted-paas-replace-heroku/)
- [Self-Hosted PaaS Showdown 2026: Coolify vs Dokploy vs CapRover vs DeployNix](https://deploynix.io/blog/self-hosted-paas-showdown-2026-coolify-vs-dokploy-vs-caprover-vs-deploynix)
- [Coolify vs Dokploy: Complete Comparison Guide 2026 (Contabo)](https://contabo.com/blog/blog-coolify-vs-dokploy-comparison/)
- [Coolify vs Dokploy (Bluehost)](https://www.bluehost.com/blog/coolify-vs-dokploy/)
- [Coolify vs Dokku vs CapRover 2026 (BuildMvpFast)](https://www.buildmvpfast.com/blog/coolify-vs-dokku-vs-caprover-self-hosted-paas-production-2026)
- [Self-hosted PaaS in 2026: Coolify vs Dokku vs CapRover vs Ownkube](https://ownkube.io/blog/self-hosted-paas-comparison-2026)
- [Compare the Best Self-Hosted PaaS Platforms for 2026 (Perlod)](https://perlod.com/tutorials/best-self-hosted-paas/)
- [Coolify vs Dokploy：VPS 自托管 PaaS 的全面对比（Cloudzy 中文）](https://cloudzy.com/cn/blog/coolify-vs-dokploy/)
- [Coolify vs Dokploy：自托管PaaS平台该怎么选？（zzbaike 中文）](https://www.zzbaike.com/52212.html)
- [Coolify vs Easypanel: Which Self-Hosted PaaS to Pick in 2026? (Contabo)](https://contabo.com/blog/coolify-vs-easypanel-best-paas/)

### 官方文档

- [Coolify Docs — Traefik Proxy Overview](https://next.coolify.io/docs/core/networking/proxy/traefik/overview)
- [Coolify Docs — Databases & Backups](https://next.coolify.io/docs/databases/backups)
- [Dokploy Docs — Domains & Routing](https://mintlify.wiki/Dokploy/dokploy/core-concepts/domains-routing)
- [Dokploy Docs — Backup Strategies](https://mintlify.wiki/Dokploy/dokploy/advanced/backups)
- [Dokploy Docs — Database Backups](https://mintlify.wiki/Dokploy/dokploy/databases/backups)
- [Dokploy Docs — Remote Servers / Multi-server](https://docs.dokploy.com/docs/core/remote-servers)

### 定价与许可证

- [Coolify Pricing 2026 (Temps)](https://temps.sh/blog/coolify-pricing-explained-2026)
- [Coolify Pricing Teardown (Beton)](https://www.getbeton.ai/blog/coolify-pricing-teardown/)
- [Coolify's rise to fame, and why it could be a big deal (HN)](https://news.ycombinator.com/item?id=41356239)
- [Dokploy star history](https://www.star-history.com/dokploy/dokploy/)

### 已知问题与适配

- [coolify#6215: proxy loses connectivity on custom Docker networks (504)](https://github.com/coollabsio/coolify/issues/6215)
- [coolify#4276: Network settings do not apply on apps created from templates](https://github.com/coollabsio/coolify/issues/4276)
- [coolify#7204: Traefik version hard-coded to v3.1 instead of tracking latest (v3.6)](https://github.com/coollabsio/coolify/issues/7204)
- [coolify#7567: Default Traefik image (v3.1) incompatible with newer Docker Engines](https://github.com/coollabsio/coolify/issues/7567)
- [coolify v4.0.0-beta.444 release](https://newreleases.io/project/github/coollabsio/coolify/release/v4.0.0-beta.444)
- [traefik#9064: go-acme/lego Tencent Cloud DNS invalid domain fix](https://github.com/traefik/traefik/issues/9064)
- [traefik#527: Add SSE support](https://github.com/traefik/traefik/pull/527)
- [Dokploy 国内安装指南（掘金）](https://juejin.cn/post/7486788421933350924)
- [国内服务器 Coolify 部署避坑指南（CSDN）](https://blog.csdn.net/motor/article/details/153706048)
- [使用 Dokploy 部署网站服务（oldj.net）](https://oldj.net/article/2025/04/20/deploy-website-with-dokploy)

（三份并行外部调研 subagent 的详细报告结论在对应小节合并引用，来源以各 subagent 输出为准。）

## 结论摘要

基于 2026-08 外部调研（三份并行调研：Coolify、Dokploy、其他候选 + Traefik 迁移），并经
项目方澄清（pgvector 为社区镜像非自打包、监控栈方向为 Victoria 系列、PaaS 控制平面与
Lucent 业务分机部署、Coolify 自 v4.0.0-beta.444 起默认 Traefik 已更新为 v3.6），Lucent
（双机拓扑：PaaS 控制平面机 + 业务机、单应用、单人运维、已有严格部署脚本）的候选排序：

1. **Dokploy（适配度 7.5/10）**：与 Lucent 现状匹配度最高——compose 一等公民、Docker
   Image 任意 registry（含腾讯云 TCR）拉取 + registry 回滚、内置 Traefik v3.6 + 自动
   Let's Encrypt、Apache-2.0（+ DSAL）自托管免费。主要风险：2026-07 批量安全公告需及时
   升级、无原生 pre-deploy migrate 钩子（migrate 需落到启动命令/GHA 编排）、SSE/WS 需实测。
2. **Coolify（适配度 7.0/10）**：最流行（60.9k stars）、默认 Traefik v3.6（自
   v4.0.0-beta.444 起；早期 v3.1 为历史问题）、「CI 构建镜像→registry→PaaS 拉取」官方
   一等公民路径、Apache-2.0 全功能免费。主要减分：高频发版 + 升级回归实证多、2026-01
   十一连严重 CVE（控制平面权限极大）、compose 应用无滚动更新、官方明示滚动不保证零停机。
3. **其他候选（CapRover/Dokku/Easypanel/Portainer）**：见对比表与详细小节；定位或维护
   状态不适合作为 Lucent 的主选。

**推荐：Dokploy 为 Lucent 自托管 PaaS 首选，Coolify 为备选。** 无论选哪个：

- 部署拓扑：**PaaS 控制平面与 Lucent 业务分两台机器**——控制平面机跑 PaaS 本体，业务机
  跑 Lucent compose（app/postgres/redis/Victoria 监控栈），PaaS 经 agent/SSH 管理业务机；
- 推荐**模式 A**（保留 GitHub Actions 构建镜像推 TCR → PaaS 拉取部署），对现有 CI 改动最小；
- 保留 deploy.ts 的核心门禁语义（pg_dump 快照、migrate、smoke）——PaaS 的「健康检查 +
  回滚」不覆盖业务级 smoke；
- Postgres（pgvector 社区镜像 `pgvector/pgvector:pg18`）继续以容器部署，不交给 PaaS 托管
  模板（托管模板为标准 postgres，不带 vector 扩展）；
- 监控栈按「轻量化可观测性」方向（见 `plans/observability-lightweight-research.md`）换
  Victoria 系列（victoria-metrics 单机 + 按需 vmalert），继续以 compose 服务自管在业务机，
  PaaS 内置监控只是补充；
- Nginx → Traefik 与 PaaS 迁移**分两步**，先单独验证 Traefik 对 SSE/限流/403 的适配。

（详细依据见「候选详细调研」「候选对比」「迁移路径分析」各节。）

## 当前 Lucent 部署基线（仓库事实）

- 生产/Staging 各一台服务器，目录 `/opt/lucent/`，Docker Compose 单机部署。
- 服务：`app`（NestJS 单 slot）、`postgres`（社区镜像 `pgvector/pgvector:pg18`——
  **非自打包镜像**，是带 vector 扩展的官方社区镜像，与本地开发/CI 一致）、`redis`、
  `nginx`、`prometheus`、`grafana`、`alertmanager`（profile=alerting，默认关）、三个 exporter。
- 计划中的拓扑调整（项目方意向）：**PaaS 控制平面与 Lucent 业务分两台机器**；监控栈按
  「轻量化可观测性」方向（`plans/observability-lightweight-research.md`）从
  Prometheus/Grafana/exporters 迁移到 **Victoria 系列**（victoria-metrics 单机 +
  按需 vmalert，应用 `/metrics` 合同不变）。本调研按该目标拓扑评估。
- 发布模型：单 slot 停机部署（15~45s 窗口），`deploy.ts` 12 步：前置检查 → `.env` 快照 →
  起 infra → 部署前 `pg_dump` 快照 → stop app → 独立容器 `prisma migrate deploy` → 更新
  `LUCENT_IMAGE` → 启动 + 健康门禁（~150s）→ nginx reload → smoke test → 企业微信通知。
- 回滚：`deploy.ts --rollback` 从 `.env.previous` 读上一镜像 tag 重部署；**schema 不回退**。
- CI/CD：GitHub Actions 构建镜像推腾讯云 TCR（`<git-sha>` tag）→ scp deploy assets →
  SSH 执行 `LUCENT_IMAGE=<ref> node deploy.ts`。生产手动触发（workflow_dispatch），Staging
  自动。见 `docs/01-reference/adr/0004-deployment-model.md` 与 `docs/01-reference/deployment.md`。
- Nginx 职责：TLS 终止（手工证书 + 过期监控 check-cert.sh）、HTTP→HTTPS 跳转、每 IP 限流
  20r/s burst 40 + 每 IP 50 并发连接、`/metrics` 外部 403 拦截、SSE 端点
  （`^/api/v1/.*/stream$`）禁缓冲 + 300s 读写超时 + 仅限连接数、安全头、OCSP stapling、
  gzip、upstream `app:3000`（keepalive 32）。
- 监控：Prometheus 15s 抓取 app/postgres/redis/node 四类 target；Grafana 预置仪表盘；
  Alertmanager 企业微信告警；告警规则含可用性/5xx/BullMQ/event loop/磁盘/证书。
- 备份：每日 `pg_dump` 本地保留 7 份 + 可选 COS 异地；每次部署前快照保留 10 份。
- 应用特性（对反代有要求）：SSE 流式 AI 响应（`SseConnectionRegistry` 优雅关闭）、
  `/metrics` Basic Auth + 反代层 403 双保险、`TRUST_PROXY=true` 依赖 `X-Forwarded-*`。
- 发布纪律：生产手动触发（低峰时段），停机窗口 15~45s；migration 计入停机窗口；
  ADR-0004 已否决蓝绿（共享 DB 无法隔离 schema 风险）。**迁移到 PaaS 后若 PaaS 提供
  滚动/零停机部署，仍需遵守同样的迁移纪律**——单实例 + 共享 DB 下「零停机」不解决
  schema 兼容问题，停机窗口决策（ADR-0004 2026-07-17 amendment）应保持。

## 评估维度（对 Lucent 的意义）

| 维度          | 现状（Nginx + 自研 deploy.ts）                                    | 迁移到 PaaS 后的关键问题                                              |
| ------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------- |
| 反代与 TLS    | Nginx 手工证书 + reload；check-cert 监控                          | PaaS 内置 Traefik + Let's Encrypt 自动续期？证书存储与续期自动化      |
| SSE           | 专门 location：禁缓冲、300s 超时、只限连接数                      | Traefik 默认不缓冲响应，但超时/限流中间件对长连接的影响需验证         |
| 限流          | nginx limit_req 20r/s + limit_conn 50                             | Traefik RateLimit middleware 等价能力与 per-IP 语义                   |
| /metrics 拦截 | nginx `location = /metrics` 403                                   | Traefik 中间件或应用层 Basic Auth 兜底是否足够                        |
| 发布          | deploy.ts 12 步（快照/migrate/健康门禁/smoke/回滚）               | PaaS 的 pre-deploy 命令、健康检查、回滚能力是否覆盖                   |
| 数据库        | pgvector 社区镜像（pg18）容器部署                                 | PaaS 托管 Postgres 模板不带 vector 扩展 → 继续容器部署                |
| 备份          | backup.sh（本地 7 份 + COS）                                      | PaaS 定时备份（本地/S3）能否替代，COS 兼容性                          |
| 监控          | Prometheus/Grafana/Alertmanager + exporters（拟换 Victoria 系列） | Victoria 系列继续以 compose 服务自管（业务机）；PaaS 是否允许任意容器 |
| CI 集成       | GH Actions 构建镜像 → TCR → SSH                                   | 「PaaS 拉取已有镜像」模式（改动最小）vs「PaaS 直接连 Git 构建」       |
| 运维面        | 单一 `/opt/lucent/` 目录 + SSH                                    | PaaS Web UI 管理（控制平面机），业务机 SSH 收敛                       |
| 资源          | 双机拓扑：控制平面机跑 PaaS 本体；业务机跑 Lucent + Victoria      | PaaS 本体资源占用不再与业务争抢；业务机规格按 compose 上限评估        |
| 中国网络      | 腾讯云 TCR/服务器，Let's Encrypt 80 挑战                          | PaaS 镜像源、DNS 挑战（DNSPod）、Telemetry 外联                       |

## 中国网络环境注意事项

- 镜像拉取：PaaS 自身镜像（Docker Hub 源）在国内服务器可能慢，需配镜像加速器
  （[国内服务器 Coolify 部署避坑指南](https://blog.csdn.net/motor/article/details/153706048)、
  [Dokploy 国内安装指南](https://juejin.cn/post/7486788421933350924)）；Lucent 镜像在腾讯云
  TCR，拉取不受影响。
- Let's Encrypt：HTTP-01 挑战走 80 端口一般可用；DNS-01 若用 DNSPod/腾讯云 DNS，注意
  Traefik 的 ACME 实现（go-acme/lego）曾有腾讯云 DNS invalid domain bug，需较新版本
  （[traefik/traefik#9064](https://github.com/traefik/traefik/issues/9064)）。
- 遥测/更新外联：PaaS 的更新检查、telemetry 到 GitHub 等域名的连通性在国内 VPS 上需验证，
  必要时禁用或走代理。

## 候选对比（外部调研结论，2026-08）

| 维度              | Coolify                                                           | Dokploy                                                   | Easypanel | CapRover           | Dokku                 | Portainer               |
| ----------------- | ----------------------------------------------------------------- | --------------------------------------------------------- | --------- | ------------------ | --------------------- | ----------------------- |
| 定位              | 完整 PaaS（类 Vercel/Heroku）                                     | 完整 PaaS（类 Vercel/Heroku）                             | 完整 PaaS | 轻量 PaaS          | 单机 PaaS（CLI）      | 容器管理面板（非 PaaS） |
| 最新版本          | v4.3.10（2026-08-21）                                             | v0.30.2（2026-08-18）                                     | 活跃      | v1.12（维护放缓）  | v0.37.1               | 活跃                    |
| GitHub stars      | ~60.9k                                                            | ~36.8k                                                    | 较少      | ~14k               | ~29k                  | ~31k                    |
| 内置反代          | Traefik v3.6（自 v4.0.0-beta.444 起；早期硬编码 v3.1 为历史问题） | Traefik v3.6.7                                            | Traefik   | Traefik v2（停滞） | nginx（内置）         | 无                      |
| 自动 TLS          | 是（Let's Encrypt，HTTP/DNS 挑战）                                | 是（Let's Encrypt；Cloudflare Tunnel/Origin CA）          | 是        | 是                 | 是                    | 无                      |
| 任意 compose 支持 | 支持但有坑（卷插值 bug、无滚动更新）                              | 一等公民（自身即 compose 体系）                           | 部分      | 弱（app 模板为主） | 弱（Dockerfile 优先） | 支持 stack              |
| Docker Image 部署 | 官方一等公民（Deploy Type: Docker Image / compose image:）        | 是（任意 registry 含 TCR，registry 回滚）                 | 是        | 是                 | 是                    | 是                      |
| 定时数据库备份    | 8 引擎；S3 兼容存储                                               | 托管 DB + S3 定时备份/恢复                                | 是        | 部分               | 插件                  | 无                      |
| 内置监控          | 基础且不稳（issue #4912）                                         | 基础（每服务资源）；高级为云版                            | 基础      | 基础               | 无/插件               | 无                      |
| 可跑自定义监控栈  | 可以（自定义 compose 服务）                                       | 可以（compose 服务）                                      | 受限      | 可以               | 可以                  | 可以                    |
| 许可证            | Apache-2.0（2026 核实，官方承诺不改）                             | Apache-2.0 + DSAL（2026-01-21 改，/proprietary 付费功能） | 待复核    | Apache-2.0         | MIT                   | CE: Zlib / BE: 专有     |
| 已知安全事件      | 2026-01 披露 11 个严重 CVE（7 个 CVSS 10.0）                      | 2026-07-21 批量披露 20 个公告（多 critical）              | —         | —                  | —                     | —                       |
| 适配 Lucent 评分  | 7.0/10                                                            | **7.5/10**                                                | 4/10      | 3/10               | 3/10                  | 2/10                    |

关键判断（综合三份调研 + 项目方澄清）：

- **Dokploy 与 Coolify 是同一档的两个主流选择**；Easypanel 定位相近但生态与文档弱于两者，
  且「内置 Traefik」版本与可定制性需复核；CapRover 内置 Traefik v2 且维护放缓，不适合新选型；
  Dokku 无 Web UI、compose 支持弱；Portainer/YunoHost 不是通用 PaaS。
- 本项目特有约束（pgvector 社区镜像、Victoria 监控栈、TCR 镜像拉取、严格部署门禁、
  PaaS 与业务分机）下，**Dokploy 的 compose 一等公民 + 任意 registry + registry 回滚**
  匹配度最高；Coolify 的优势（流行度、UI、模板）在单应用场景收益有限。
- Traefik 版本：Coolify 自 v4.0.0-beta.444 起默认 Traefik 已更新为 v3.6（早期硬编码 v3.1
  是历史问题，见 issue #7204/#7567），与 Dokploy 的 v3.6.7 同代，两者均可使用 RateLimit
  中间件（v3.2+ 实验性）；该维度不再构成两者差异。

## 候选详细调研

### Coolify（适配度 7.0/10）

- **版本/活跃度**：v4.3.10（2026-08-21）；v4.0.0 稳定版 2026-04-27 才发布（此前长期
  beta）；近每日热修 + 每月小版本；60.9k stars；公司 coolLabs Solutions Kft.（匈牙利）。
- **安全事件**：2026-01 一次性披露 11 个严重漏洞（7 个 CVSS 10.0），含命令注入
  （数据库备份/导入/Postgres init/动态代理配置/文件存储挂载/compose 文件）、低权限用户
  读取 root 私钥、存储型 XSS，可致容器逃逸；受影响版本 ≤ 4.0.0-beta.45x，已修复。
  架构性含义：自托管控制平面权限极大（可 SSH 到被管服务器、操作 Docker）。
- **许可证**：主仓库仍为 Apache-2.0（2026-08 直查 LICENSE + GitHub API 核实）；官方哲学页
  承诺「100% 开源、无付费墙功能、永不改变」；**未找到 2025 年改 Fair Source 的实际落地**。
  自托管全功能免费；Coolify Cloud $5/月（含 2 台服务器）+$3/月/台。
- **Traefik**：内置默认反代即 Traefik v3；**自 v4.0.0-beta.444 起默认版本已更新为 v3.6**
  （项目方核实；早期硬编码 v3.1 是历史问题——issue #7204 记录「硬编码 v3.1 不追踪 v3.6」、
  #7567 记录 v3.1 与新版 Docker Engine API 1.24 不兼容）；自动 Let's Encrypt；自定义走文件
  动态配置目录 `/data/coolify/proxy/dynamic/`（热加载，免重启）；可换 Caddy 或完全自管
  （切换会中断该服务器全部公网路由）。SSE/WS 推断可行但无专门文档（未验证）。
- **部署**：Docker Compose 受支持（Git 仓库 compose / 粘贴 compose / Raw Compose），
  已知坑：卷 `${VAR:-default}` 插值 bug（#10168）；「CI 构建镜像→推 registry→PaaS 拉取」
  是官方一等公民路径（Deploy Type: Docker Image + API token + 部署 Webhook）；
  健康检查（应用级/Dockerfile/compose 级）会从路由摘除不健康容器；**滚动更新仅限
  非 compose 应用且官方明示不保证零停机**；pre/post 部署命令存在（openapi.yaml）但官方
  文档缺失（docs#11）。
- **数据库/备份**：托管 8 引擎（PostgreSQL/MySQL/MariaDB/MongoDB/Redis/Dragonfly/KeyDB/
  ClickHouse）；Postgres 定时备份 + S3 兼容存储副本 + 恢复文档；官方提示必须做恢复演练。
- **监控**：内建日志/指标弱且不稳（#4912）；**允许并跑任意自定义 compose 服务**——
  现有监控栈（Victoria 系列方向）可原样并跑。
- **风险**：升级回归实证多（#10546 重定向 404、#9127 代理被改回、#4902 指标丢失、
  #9009 环境变量页 OOM）、更新维护成本高（社区比喻「WordPress 插件维护」）、compose 细节
  bug、高权限控制平面架构风险。
- **结论**：适合多应用/小团队/GitOps 场景；对本项目减分在——现有 deploy.ts 的门禁比
  Coolify 内建流程更严格、compose 无滚动、新增高权限控制平面与升级负担（Traefik 默认
  版本已跟进 v3.6，不再是减分项）。

### Dokploy（适配度 7.5/10）

- **版本/活跃度**：稳定版 v0.30.2（2026-08-18）；36.8k stars / 2.9k forks；约每月 2-4 次
  发布；发布节奏与上游依赖（Traefik 等）跟随较紧。
- **安全事件**：2026-07-21 批量披露 20 个安全公告（多为 critical 命令注入/越权）；
  单用户单机影响面较小但需及时升级。
- **许可证**：2026-01-21 改为「Apache-2.0（全部现有功能）+ DSAL 源可用许可
  （/proprietary 未来付费功能）」；自托管免费，承诺现有功能无削减；云版付费对应
  服务器级监控等高级功能。
- **Traefik**：内置反代即 Traefik v3.6.7；文件 provider 热加载，UI 可编辑 Traefik 动态
  配置；自动 Let's Encrypt；支持 Cloudflare Tunnel/Origin CA；无 Caddy 选项。
- **部署**：**Compose 一等公民**（Dokploy 自身即 docker compose 体系，Lucent 现有
  compose.yml 含 pgvector 社区镜像/双网络/profile/资源限制可整体迁移）；
  Docker Image 从任意 registry（含腾讯云 TCR）拉取；registry-based 回滚；
  Swarm 健康检查可实现零停机/自动回滚；**无原生 pre-deploy migrate 钩子**（migrate 需
  用启动命令/GHA 编排承载）；`stop_grace_period` 未在 UI 暴露（compose 方式可绕过）。
- **数据库/备份**：托管 Postgres/MySQL/MariaDB/MongoDB/Redis + S3 定时备份/恢复。
- **监控**：自托管为基础级（每服务 CPU/内存/磁盘/网络）；高级服务器级监控（4500 端口
  agent）为云版功能；Prometheus/Grafana 可作 compose 服务自建（本项目已有）。
- **风险**：2026-07 安全公告群；v0.27.1 内存回归（~630MB 空闲）；升级偶发破坏（#4002/
  #4392）；SSE/WebSocket 文档未明确（靠 Traefik 透传，需实测）；无原生 migrate 钩子。
- **结论**：与 Lucent 现状（compose、pgvector 社区镜像、Victoria 监控栈方向、TCR
  镜像拉取）匹配度最高；deploy.ts 的「快照→migrate→smoke」编排需改用 GHA/API 重新实现，
  SSE/WS 与手写限流/头中间件需自行验证。

### 其他候选（非主选）

- **Easypanel**：真 PaaS，内置 Traefik；定位最接近 Coolify/Dokploy，但生态、文档与社区
  弱于两者；许可证标识待复核（SPDX 未完成项）；不适合作为 Lucent 主选。
- **CapRover**：真 PaaS，内置 Traefik **v2**（停滞版本）；维护放缓（v1.12）；以 app 模板
  为主，compose 支持弱；不适合新选型。
- **Dokku**：真 PaaS（CLI，无 Web UI），默认 nginx，MIT，v0.37.1；Dockerfile 优先、
  compose 支持弱；是「单机 Heroku 风格」但不是本项目要的「反代换成 Traefik + Web UI 管理」。
- **Portainer**：容器管理面板（CE: Zlib / BE: 专有），非 PaaS：无自动 TLS/反代/构建编排；
  只适合作为纯容器管理补充工具。
- **YunoHost**：家庭服务器发行版定位（AGPL，nginx），非通用 PaaS。

### Traefik 迁移要点（Nginx → Traefik 专项）

- **SSE/WebSocket**：Traefik 默认不缓冲响应，WS 升级与 SSE 透传原生支持（traefik#527
  即 SSE 支持）；无需 nginx 式 `proxy_buffering off`，但**需在 router 上配置超时语义**以
  还原 nginx `proxy_read_timeout 300s`（PaaS 生成的默认路由是否可调需实测）。
- **限流**：RateLimit 中间件 **Traefik v3.2+ 引入且为实验性**，按 sourceCriterion（IP）
  的 token bucket；**SSE 长连接路由不应挂 RateLimit**（与 nginx 现状一致，只限连接数）；
  `limit_conn`（每 IP 并发连接数）Traefik **无直接等价**，可接受或依赖应用层。
- **/metrics 403**：可用 ipAllowList 拒绝网段（白名单反向）或自定义中间件；应用层
  Basic Auth 兜底已存在，反代层拦截是纵深防御，可降级为仅应用层。
- **ACME**：内置 Let's Encrypt（HTTP-01/DNS-01，证书存 acme.json）；DNS-01 走 DNSPod/
  腾讯云 DNS 需较新 go-acme/lego（traefik#9064 修复过腾讯云 invalid domain）。
- **短板**：无 Lua、rewrite 能力弱于 nginx；errors 中间件曾有请求头泄露通告
  （GHSA-p6hg-qh38-555r）；CVE-2025-66491 曾致 TLS 校验被关闭数月——**使用方必须跟随
  Traefik 安全更新**（PaaS 内置 Traefik 时跟随 PaaS 升级节奏；Coolify 默认 Traefik 已
  跟进 v3.6（自 v4.0.0-beta.444），早期硬编码 v3.1 的历史问题不再成立，但仍需关注
  PaaS 对内置 Traefik 的升级及时性）。
- **file provider vs docker labels**：PaaS 内通常用 docker provider + 资源 labels 生成
  路由；自定义中间件/错误页走 file provider 动态目录（Coolify 官方支持热加载路径；
  Dokploy UI 可编辑 Traefik 动态配置）。

## 迁移路径分析

### 两种部署模式

- **模式 A（推荐评估）：CI 构建镜像，PaaS 拉取部署。** 保留 GitHub Actions 的
  `lucent-production.yml` 前半段（buildx → TCR push），去掉 SSH/upload/deploy.ts 部分；
  在 PaaS 上为 Lucent 建一个「Docker Image」类型资源，镜像 tag 更新后触发拉取部署。
  - 优点：镜像构建环境不变（含 `pnpm prisma:generate` 的 .ts→.js 修复步骤）；PaaS 不做
    构建，不受其构建环境/依赖影响；与现有 GH Actions 审批流程兼容。
  - 代价：仍需管理 registry 凭证（PaaS 侧配 TCR 登录）；镜像推送后需通知 PaaS（webhook/
    API 或手动点部署）。
- **模式 B：PaaS 直接连 Git 构建。** PaaS 上配置 GitHub 仓库，push 触发 PaaS 内构建。
  - 优点：部署入口完全收敛到 PaaS UI；无需 registry 凭证。
  - 代价：构建环境迁移（buildkit 缓存、`pnpm prisma:generate` 修复步骤、Dockerfile 多阶段
    在 PaaS 构建器的兼容性需实测）；腾讯云 TCR 不再必要；CI 中 lint/test 与构建解耦。

### deploy.ts 12 步在 PaaS 下的去留

| 步骤                         | 现状               | PaaS 迁移后                                                               |
| ---------------------------- | ------------------ | ------------------------------------------------------------------------- |
| 1. 前置检查 + render-configs | deploy.ts          | 保留（若继续自管监控栈）；PaaS 资源检查替代部分                           |
| 2. 读旧镜像                  | deploy.ts          | PaaS 自动（回滚目标由 PaaS 管理）                                         |
| 3. `.env` 快照               | deploy.ts          | PaaS 环境变量管理替代（注意：PaaS 也应有回滚前快照）                      |
| 4. 起 postgres/redis         | deploy.ts          | PaaS 或 compose 管理                                                      |
| 5. 部署前 pg_dump 快照       | deploy.ts          | **保留**（PaaS 备份不保证在发布瞬间，且 COS 异地副本依赖 backup.sh 语义） |
| 6. stop app（停机开始）      | deploy.ts          | PaaS 部署动作替代（停机窗口仍存在，除非 PaaS 滚动）                       |
| 7. prisma migrate deploy     | deploy.ts 独立容器 | PaaS pre-deploy 命令（镜像内已有 prisma CLI）；失败中止语义需验证         |
| 8. 更新 LUCENT_IMAGE         | deploy.ts          | PaaS 管理                                                                 |
| 9. 健康门禁 ~150s            | deploy.ts          | PaaS 健康检查（轮询 /api/v1/health）+ 失败回滚需验证                      |
| 10. nginx reload             | deploy.ts          | 消失（Traefik 动态发现容器，无需 reload）                                 |
| 11. smoke test               | deploy.ts          | 保留为部署后手动/CI 步骤                                                  |
| 12. 通知                     | deploy.ts          | PaaS webhook 或保留脚本                                                   |

结论：deploy.ts 中「镜像/健康/回滚」职责移交 PaaS；「DB 快照、smoke、通知」可保留为
独立脚本（由 PaaS webhook 或 CI 触发）。

### Nginx → Traefik 逐项映射

| Nginx 现状                             | Traefik 对应                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| TLS 手工证书 + check-cert.sh           | 自动 Let's Encrypt（HTTP-01 或 DNS-01）；证书存储由 PaaS 管理                 |
| HTTP→HTTPS 跳转                        | 内置（redirectscheme 中间件 / PaaS 默认）                                     |
| limit_req 20r/s burst 40（per IP）     | RateLimit middleware（average/burst，sourceCriterion 按 IP）                  |
| limit_conn 50（per IP）                | 无直接等价（Traefik 无连接数限制中间件；可接受或依赖应用层）                  |
| `location = /metrics` 403              | 应用层 Basic Auth 兜底已存在；Traefik 侧可用自定义中间件或保持仅应用层        |
| SSE 禁缓冲 + 300s 超时 + 仅限连接数    | Traefik 默认不缓冲响应；router 级 readTimeout 配置；RateLimit 不应挂 SSE 路由 |
| 安全头 / OCSP stapling / gzip          | Traefik 中间件（headers/customRequestHeaders）、PaaS 层或应用层 Helmet 兜底   |
| upstream 容器 IP 缓存问题（需 reload） | 不存在（Traefik 由 Docker provider 动态发现）                                 |

SSE 是迁移的核心验证项：需实测 PaaS 生成的 Traefik 路由上流式响应不被缓冲/截断、
超时配置不杀死长连接（当前 nginx `proxy_read_timeout 300s` 的语义要还原）。

### 保留/退役清单（迁移后）

- 保留：GitHub Actions CI（lint/typecheck/test/build）、`backup.sh`（或迁到 PaaS 备份）、
  smoke 脚本、应用层 `/metrics` Basic Auth、Victoria 监控栈（victoria-metrics 单机 +
  按需 vmalert，业务机 compose 服务）。
- 退役：`deploy.ts` 的部署编排、`render-configs.sh` 若监控栈退役、`check-cert.sh`
  （自动续期后）、Nginx 配置与 `logs/nginx`、Prometheus/Grafana/exporters（按
  `observability-lightweight-research.md` 方案迁移到 Victoria 系列）。
- 注意：pgvector 依赖（`pgvector/pgvector:pg18` 社区镜像）——PaaS 托管 Postgres 模板
  为标准 postgres 不带 vector 扩展，Postgres 继续以该社区镜像容器部署（compose 方式，
  Dokploy 可整体承载）。

## 中间路径：不迁移 PaaS，仅 Nginx → Traefik

如果暂时不引入 PaaS，也可在现有 compose 内把 `nginx` 服务换成 `traefik` 容器：

- compose 增加 `traefik` 服务（官方镜像 + `--providers.docker` + file provider），
  `app` 服务加 Traefik labels（router/middleware/证书）。
- TLS：Traefik 内置 ACME 自动续期，替代手工证书 + check-cert.sh（注意 ACME 存储卷持久化）。
- 需要迁移的 nginx 特性：rate limit、/metrics 拦截、SSE 超时、安全头（见上表）。
- deploy.ts 的「nginx reload」步骤改为「等待 Traefik 服务发现」或删除；健康门禁与回滚逻辑不变。
- 收益有限（仍自管 compose/证书之外的运维），但比 PaaS 迁移风险小；可作为 PaaS 迁移前的
  过渡验证（验证 Traefik 对 SSE/限流的适配后再整体迁移）。

## 推荐结论

**选型：Dokploy（首选）—— 备选 Coolify。**

理由（按权重）：

1. **迁移阻力最小**：Lucent 现有 `deploy/compose.yml`（pgvector 社区镜像、双网络、
   profile、资源限制）在 Dokploy 的 compose 一等公民模型下可整体迁移；Coolify 的 compose
   支持有已知坑（卷插值、无滚动更新、自定义网络 issue）。
2. **部署模式对得上**：Dokploy 支持 Docker Image 从任意 registry（腾讯云 TCR）拉取 +
   registry 回滚，与现有「GH Actions 构建镜像推 TCR」流水线同构；Coolify 同样支持，但
   Dokploy 的回滚语义与镜像 tag 绑定更直接。
3. **Traefik 版本同代**：两者内置 Traefik 均已跟进 v3.6（Coolify 自 v4.0.0-beta.444 起、
   Dokploy v3.6.7），RateLimit 中间件（v3.2+ 实验性）两者都可用；该维度不构成差异，
   Dokploy 对上游版本跟随更紧（按月更新 vs Coolify 近乎每日热修）。
4. **可观测性延续**：Victoria 系列（victoria-metrics 单机 + 按需 vmalert）继续以
   compose 服务自管在业务机——两者都允许任意 compose 服务，但 Dokploy 的 compose 支持
   让监控栈迁移零改写。
5. **许可证**：两者自托管均免费（Dokploy: Apache-2.0 + DSAL；Coolify: Apache-2.0）；
   无实质差异。
6. **风险对冲**：Dokploy 2026-07 安全公告群（20 个）与 Coolify 2026-01 CVE 群（11 个）
   都是「控制平面权限大 → 必须及时升级」的同类风险；Dokploy 升级频率更低（约每月 2-4
   次 vs Coolify 近乎每日热修），维护负担略小。两者都要求把 PaaS 本身纳入升级运维。
   分机部署（控制平面与业务隔离）可缩小单点影响面，但控制平面失守仍可经 agent/SSH
   触达业务机。

**实施前提与建议（无论选哪个）：**

- **部署拓扑**：两台机器——控制平面机（PaaS 本体 + 其数据库；Dokploy 需在业务机装
  agent，Coolify 同理）、业务机（Lucent compose：app/postgres/redis/Victoria 监控栈）。
  域名与 TLS 由 PaaS 在控制平面机上的 Traefik 统一签发，或业务机独立反代——需在实施
  plan 中确定 DNS 指向与证书归属。
- **分两步走**：先「中间路径」验证 Traefik（在现有 compose 内把 nginx 换 traefik，验证
  SSE/限流/403/证书自动续期），再迁移 PaaS；不要把 Nginx→Traefik 与 PaaS 迁移捆绑上线。
- **模式 A**：保留 GitHub Actions 构建镜像推 TCR；PaaS 侧用 Docker Image 资源 + 部署
  Webhook/API；`lucent-production.yml` 删掉 SSH/upload/deploy.ts 段。
- **保留 deploy.ts 的严格门禁语义**：pg_dump 快照（发布前）、smoke test、企业微信通知
  改由 GHA 步骤或独立脚本承载；PaaS 健康检查只负责容器级门禁。
- **migrate 承载**：Dokploy 无原生 pre-deploy 钩子 → 用镜像启动命令/entrypoint 脚本
  （`prisma migrate deploy && node dist/main.js`）或 GHA 在部署前通过 `docker exec`/
  临时容器执行（保持现有「migrate 失败即中止」语义）；Coolify 有 pre/post 命令但文档缺失，
  同样需验证。
- **Postgres 不托管**：pgvector 依赖（`pgvector/pgvector:pg18` 社区镜像）使托管模板
  不可用，Postgres 保持容器部署；PaaS 备份功能可用作补充，`backup.sh` + COS 链路保留。
- **监控栈**：按 `observability-lightweight-research.md` 方向换 Victoria 系列，
  应用 `/metrics` 合同与 Basic Auth 不变；vmalert 规则从现有 `lucent.yml` 迁移。
- **SSE 验收**：迁移前必须在 staging 实测 AI 流式响应（长流不被截断、SIGTERM 时
  `server_shutdown` 事件可送达、300s 超时语义还原）。
- **SSH 收敛**：PaaS 接管后，业务机 SSH 仅保留给 PaaS agent 与排障；GitHub Secrets 中的
  DEPLOY\_\* 退役，替换为 PaaS API token。
- **机器规格**：控制平面机按 PaaS 本体要求（Dokploy 约 1-2GB 内存可跑、Coolify 更重）；
  业务机规格按 compose 上限评估（app 1G + postgres 1G + redis 256M + Victoria 单机
  - 应用日志等）。

**不推荐**：Easypanel（生态弱、许可证待复核）、CapRover（Traefik v2、维护放缓）、
Dokku（无 UI、compose 弱）、Portainer/YunoHost（非 PaaS）。

> 决策时机：本文为调研选型文档。若采纳 Dokploy，另起实施 plan（含 staging 试点、Traefik
> 专项验证、GHA 改造清单），并在实施后更新 ADR-0004（部署模型）与
> `docs/01-reference/deployment.md`；当前不修改任何生产部署代码。
