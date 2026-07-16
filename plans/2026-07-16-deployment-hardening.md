# Lucent 部署加固计划：容错性、可控性与线上可排查性（2026-07-16）

来源：2026-07-16 部署与生产运维专项审查（`deploy/` 全部内容、`Dockerfile`、3 个 GitHub workflow、`src/common/{logger,metrics,queue}`、健康探针、配置校验、AdminJS、相关 ADR 交叉核对）。

总体评价：部署流水线骨架质量不错（多阶段非 root 镜像 + tini、zod 环境校验、蓝绿脚本、smoke test、AdminJS 后台），但存在 **1 个回滚逻辑 bug 级别的严重缺陷** 和若干容错/可排查性缺口。

每条完成并落地到 docs 后，从本文件删除对应章节。

**建议落地顺序**：#1（半天）→ #2（半天）→ #5（1-2 天）→ #4（1-2 天）→ #8/#7（各半天）→ #6（半天-1 天）→ 其余按排期。

---

## 高优先级

### 1. 回滚机制实际失效：`.env.previous` 快照时机错误（bug）

**问题**：`deploy.ts` 第 14 步把**已更新为新镜像/新 slot 的** `.env` 快照为 `.env.previous`，第 15 步才跑 smoke test。smoke 失败触发 `rollback()` 时，从 `.env.previous` 读到的"上一版本"就是刚部署的坏版本——回滚等于原地重部署坏镜像。手动 `node deploy.ts --rollback` 同样失效：每次成功部署后 `.env.previous` 被覆盖成当前状态，**永远回不到上一个版本**。

**证据**：`deploy/deploy.ts:355-357`（快照在 smoke 之前）、`deploy/deploy.ts:364-370`（smoke 失败调 rollback）、`deploy/deploy.ts:392-395`（rollback 从 `.env.previous` 读 `LUCENT_IMAGE`）。

**行动**：

1. deploy 开始（修改 `.env` 之前）先把当前 `.env` 快照为 `.env.previous`，smoke 全通过后再覆盖快照。
2. 加 deploy 脚本单测覆盖此顺序。

**工作量**：小。

### 2. smoke test 在流量切换之后才执行，故障窗口暴露给用户

**问题**：当前顺序：重写 nginx upstream（步骤 10）→ reload（11）→ **停旧 slot（12）** → smoke test（15）。新 slot 有运行时问题时用户已真实吃到错误，且旧 slot 已停，回滚也要等冷启动。

**证据**：`deploy/deploy.ts:323-371`。

**行动**：切流**前**对新 slot 做 pre-switch smoke——`docker exec lucent-app-<slot> curl /api/v1/health/ready`（复用 smoke.ts 已有的容器内 curl 基建），通过后再 rewrite upstream；切流后保留现有 post-switch smoke。步骤 9 的 compose healthcheck + pre-switch smoke 形成双重门禁。

**工作量**：小。

### 3. 蓝绿部署与 DB migration 不兼容，回滚不含 schema 回退

**问题**：`prisma migrate deploy` 在**旧 slot 仍在服务**时对共享生产库执行。破坏性迁移（drop/rename 列）会立刻打挂线上旧版本；`rollback()` 完全不处理 schema 回退。当前无 expand-contract 迁移纪律。

**证据**：`deploy/deploy.ts:306-307`（步骤 7 在新 slot 启动前 migrate）、`deploy/deploy.ts:382-451`（rollback 无 migrate 逻辑）；`docs/01-reference/deployment.md:127-151` 未提迁移兼容性要求。

**行动**：

1. `deployment.md` + PR 模板写入 expand/contract 纪律（破坏性变更拆两次发布：先扩、发布、后收缩）。
2. CI 加 `prisma migrate diff` 检测 DROP/ALTER 并打警告。
3. 文档明确"回滚仅回滚应用版本，schema 不回退"。

**工作量**：中。

### 4. 零告警通道：无 Alertmanager、无告警规则、无任何通知 webhook

**问题**：线上故障发现完全依赖用户反馈或主动盯 Grafana。ADR-0006 明确承诺的"5xx 错误率、健康检查失败、内存、队列积压"告警未落地。与 #8（面板实际不可访问）叠加等于"有仪表盘但没人看、看了也没人管"。

**证据**：`deploy/prometheus/prometheus.yml`（仅 1 个 scrape job，无 `rule_files`/alerting）；`deploy/compose.yml:164-220`（无 alertmanager 服务）；全仓库无企业微信/钉钉/Telegram 等通知通道；`docs/01-reference/adr/0006-observability-strategy.md:47`。

**行动**：

1. compose 加 `prom/alertmanager` + webhook 适配器（企业微信群机器人最简单）。
2. rules 覆盖：`up == 0`、`/health/ready` 5xx、http 5xx 率超阈值、`bullmq_jobs_total{status="failed"}` 增长率、`nodejs_event_loop_lag`、磁盘水位（配合 #12）。

**工作量**：中。

### 5. 无数据库备份与恢复能力

**问题**：PostgreSQL 仅有宿主机 bind mount `./data/postgresql`，无 pg_dump 定时任务、无 WAL 归档、无异副本、无恢复演练文档。单机磁盘故障 = 数据全丢。ROADMAP 自己列为未完成项。

**证据**：`deploy/compose.yml:54-83`（postgres 无备份 sidecar）；`ROADMAP.md:57,77`；全仓库 grep `pg_dump|backup|wal-g` 仅命中 ROADMAP。

**行动**：

1. 每日 `pg_dump` sidecar 容器（或宿主机 cron）+ 上传腾讯云 COS（项目已有 COS SDK/bucket，运维链路一致），保留 7 日热备 + 30 日冷备。
2. `docs/01-reference/how-to/` 补恢复演练 runbook，每季度实际恢复一次到 staging 验证。

**工作量**：中。

### 6. 每次发布掐断进行中的 SSE 流（AI 对话流式响应）

**问题**：nginx reload 后 deploy.ts **立即** `docker stop` 旧 slot（grace 30s）；SSE 端点 nginx `proxy_read_timeout 300s`，AI 流式生成动辄数分钟。应用侧无连接排空：`enableShutdownHooks()` 只等 BullMQ `worker.close()`，SSE 工具无活跃连接追踪。发布 = 所有在用 AI 对话强制中断。

**证据**：`deploy/deploy.ts:342-343`、`deploy/compose.yml:27`、`deploy/nginx/nginx.conf:115`、`src/main.ts:25`、`src/common/api/sse.ts`（无 shutdown 处理）。

**行动**：

1. 低成本：deploy.ts 切流后 sleep 可配置的 `DRAIN_SECONDS`（如 300s）再 stop 旧 slot。
2. 彻底方案：应用内追踪活跃 SSE 连接，shutdown 时先向客户端发 `done`/`error` 事件触发前端重试再关闭。

**工作量**：小（deploy 侧）/ 中（应用侧）。

---

## 中优先级

### 7. BullMQ 队列深度 gauge 定义了但从未接线，队列积压不可见

**证据**：`src/common/metrics/metrics.service.ts:79-91` 定义了 `bullmq_active_jobs`/`bullmq_waiting_jobs`，但生产代码无一处调用 setter（grep 仅命中定义和 spec mock）；ADR-0006 承诺的"队列深度可视化"未兑现。

**行动**：在 `BullmqQueueFactory` 用 30s interval 或 QueueEvents 周期性 `queue.getJobCounts()` 刷新两个 gauge。

**工作量**：小。

### 8. Grafana/Prometheus 按文档方式实际无法访问（端口未发布）

**证据**：`deployment.md:312-323` 指示 `ssh -L 3001:localhost:3001` 访问，但 `deploy/compose.yml:164-220` 两个服务都**没有 `ports:` 发布**，宿主机 localhost 上没有监听。

**行动**：compose 加 `127.0.0.1:3001:3000` / `127.0.0.1:9090:9090` 本地绑定发布（配合 SSH 隧道仍安全），同步修正文档。

**工作量**：小。

### 9. 请求级日志盲区：成功请求无应用日志，requestId 非结构化

**问题**："查某个请求的完整日志"目前只能靠 nginx access log + 运气。requestId 只在 4xx/5xx 和慢请求时出现，且嵌在 message 文本里（`[reqId=]`），不是 JSON 结构化字段。

**证据**：`src/common/logger/logger.config.ts:44-50`（注释明确"不做 per-request access logging"）、`src/common/filters/api-exception.filter.ts:52-53`（reqId 内嵌文本）。

**行动**：

1. onResponse hook 加轻量完成日志（info 级 JSON：reqId/method/route/status/durationMs，2xx 可采样降级）。
2. Winston format 从 AsyncLocalStorage 注入 `requestId` 为顶层字段，方便 `jq`/`grep` 检索。

**工作量**：中。

### 10. DB 层完全黑盒：Prisma 无查询日志，Postgres 无慢查询日志

**问题**：线上"接口慢是 DB 还是 LLM"无法区分。ADR-0006 的 `db_query_duration_seconds`（可选）未实现。

**证据**：`src/prisma/prisma.service.ts`（无 log 配置、无 `$on('query')`）；`deploy/compose.yml:54-83`（postgres 无自定义 command）。

**行动**：

1. postgres command 追加 `-c log_min_duration_statement=500`（日志走 docker json-file，已有 50m×5 轮转）。
2. Prisma log 配置 `['warn','error']` 起步。

**工作量**：小。

### 11. 生产为 CI 成功全自动部署，与文档宣称的人工门禁矛盾

**问题**：`lucent-production.yml` 的 deploy job 触发条件是 main 分支 CI 成功（`workflow_run`）——**合并进 main 就自动上生产**；而 `deployment.md:177-181` 写的是"staging 验证后人工确认、手动 `workflow_dispatch` 触发"。若 GitHub environment `production` 未配 required reviewers（仓库内不可见），staging 验证形同虚设。

**证据**：`.github/workflows/lucent-production.yml:14-33`。

**行动**：二选一并写进文档——给 environment 配 required reviewers（GitHub 网页设置），或删除 `workflow_run` 自动触发只保留 `workflow_dispatch`。

**工作量**：小。

### 12. 无基础设施层指标：postgres/redis/nginx/宿主机全部无 exporter

**问题**：Prometheus 只 scrape 两个 app slot。DB 连接数/锁/缓存命中、Redis 内存、nginx 状态、**宿主机磁盘水位**（`data/` + `logs/` + docker json-file 同盘）全部不可见。磁盘写满这类最常见单机故障毫无预警。

**证据**：`deploy/prometheus/prometheus.yml`（仅 lucent job）；`deploy/compose.yml`（无 exporter 服务）。

**行动**：compose 加 `postgres_exporter`、`redis_exporter`、`node_exporter`（合计 <100MB 内存），Grafana 导入现成 dashboard，磁盘告警接入 #4 的 Alertmanager。

**工作量**：中。

---

## 低优先级

### 13. 镜像无安全扫描与 SBOM，CI 不验证 Docker 构建

**证据**：`.github/workflows/lucent-production.yml:73-74` 显式 `sbom: false, provenance: false`；`.github/workflows/lucent-ci.yml:98-99` 只跑 `nest build`，Dockerfile 错误要等 CD 才暴露。

**行动**：CI 加 `docker build`（不推送）+ `trivy image --severity HIGH,CRITICAL --exit-code 1`。

**工作量**：小。

### 14. TLS 证书纯手工管理，无续期自动化与过期告警

**证据**：证书以 `./certs` bind mount 注入（`deploy/compose.yml:130-131`），docs 仅写"运维管理"（`deployment.md:32-33,102-108`），全仓库无 certbot/acme.sh。证书过期 = 全站 HTTPS 中断，靠人记忆。

**行动**：acme.sh 宿主机 cron + deploy hook reload nginx；最低成本先做一步——cron 脚本检查证书有效期并接入 #4 告警。

**工作量**：中。

### 15. 零散硬化点打包

- **限流为进程内存存储**：`app.module.ts:64-69` `ThrottlerModule.forRoot` 无 `storage`，而 `environment.validation.ts:444` 注释声称 "REDIS_URL required for distributed rate limiting"——实现与注释不符，切 slot 瞬间限流计数清零。改 Redis 存储或修正注释。**工作量**：小。
- **`deploy.ts` 重写 `.env` 丢注释且权限不受控**：`writeEnvFile`（`deploy/deploy.ts:92-95`）全量重写丢失注释/引号格式；`.env`/`.env.previous` 权限依赖默认 umask。显式 `chmod 600`。**工作量**：小。
- **nginx 公网侧无 limit_req/连接数限制**：DDoS/突发流量下 nginx 先于应用被打满。加 `limit_req_zone` + `limit_conn`。**工作量**：小。
- **compose healthcheck 用含 DB/Redis 探测的 ready 探针**：`deploy/compose.yml:33` 打 `/api/v1/health`（=`getReadyHealth`，`src/app.service.ts:32-34`），部署窗口内 DB 抖动会中止发布（行为可接受但要有预期）；运行时 unhealthy 不会自动重启，文档注明。**工作量**：小（文档）。
- **LLM 调用无熔断器**：已有超时（`AI_MODEL_TIMEOUT_MS=10s`）+ 错误分类重试（`llm-retry.helper.ts`），连续故障时无快速失败。可用简单计数器或 `opossum` 补齐。**工作量**：中。

---

## 已有的良好实践（不建议改动）

- `Dockerfile`：三阶段构建、非 root 用户、tini PID 1、pnpm 缓存挂载
- 环境变量 zod 校验含生产断言（必填项、CORS≠`*`、JWT 密钥长度）
- AdminJS 后台（`/admin`）可直接查库排障
- 健康三探针（live/ready/deep）设计合理
- CI 门禁完整（lint/typecheck/unit/e2e/build）
- LLM 调用有超时 + 错误分类重试

**与架构审查计划的衔接**：Worker/Cron 拆出 API 进程、failed job 死信告警、异步任务结果持久化已在 `2026-07-16-architecture-review.md` #7/#8 跟踪，本文件不重复。
