# ADR-0015: .env → YAML Configuration + Coolify/Traefik Deployment + VictoriaMetrics

- **Status**: accepted
- **Date**: 2026-08-24
- **Deciders**: LuoMuLoyal
- **Supersedes in part**: [ADR-0004](0004-deployment-model.md)（部署模型：GitHub Actions + TCR + SSH + `deploy.ts` → Coolify PaaS）；[ADR-0006](0006-observability-strategy.md)（监控栈：Prometheus + Grafana → VictoriaMetrics 单机）

## Context

Lucent 当前的配置和部署体系存在三个问题：

1. **配置扁平化**：所有配置（敏感和非敏感）混在 `.env` 中，无法表达嵌套分组。默认值埋在代码里（`constants.ts` + Zod `.default()`），没有声明式的可审查配置文件。
2. **部署脚本过重**：`deploy.ts`（650 行、12 步流程）+ `compose.yml` + Nginx 手动维护 SSL/限流/SSE 配置，维护成本高。新获得 2C2G + 2C4G 两台服务器（不在内网），可以分机部署 PaaS 和应用。
3. **监控栈过重**：Prometheus + Grafana + exporters 占约 1.15 GB，对 2C4G 单机造成资源压力。

## Decision

### 1. 非敏感配置从 `.env` 迁移到 `config/` 下的 YAML

- YAML 存放在 `Lucent/config/`，与 `src/config/` 配置代码分离。
- 文件层次：`config/default.yaml` + `config/<NODE_ENV>.yaml` + `config/<NODE_ENV>.local.yaml`。
- 不创建 `.env.defaults`——默认值由 `config/default.yaml`（显式声明）和 Zod `.default()`（代码安全网）两层提供。
- `.env` 精简为只保留敏感变量（凭证、连接串）和启动选择器（`NODE_ENV`、`OTEL_ENABLED`、`TRUST_PROXY`）。
- 优先级：`PaaS env > .env.<env>.local > .env.<env> > config/<env>.local.yaml > config/<env>.yaml > config/default.yaml > Zod .default()`。
- Prisma CLI 保持独立加载 `.env`，不依赖 Nest 或 YAML。

### 2. 从 `deploy.ts` + Compose + Nginx 切换到 Coolify + Traefik

- Coolify 部署在 2C2G 管理服务器，通过 SSH 远程管理 2C4G 应用服务器。
- Traefik 替代 Nginx（Coolify 自带，自动安装到被管理服务器）。接受能力降级：`limit_conn` 无原生等价物，由应用层 ThrottlerModule + SseConnectionRegistry 覆盖。
- CI 构建镜像推到 GitHub Container Registry，Coolify 只拉取部署，不在服务器上构建。

### 3. 从 Prometheus + Grafana 切换到 VictoriaMetrics 单机

- VictoriaMetrics 部署在 2C4G 应用服务器，绑定 `127.0.0.1:8428`，localhost 抓取 `/metrics` 不走公网。
- VMUI 通过 SSH 隧道访问。需要告警时添加 `vmalert`（同样绑定 localhost）。
- `prom-client` 和 `/metrics` 端点不变。不引入 VictoriaLogs/VictoriaTraces——Winston 日志和 OTel → Jaeger（ADR-0010）已覆盖 logs/traces 支柱。

## Options Considered

| Option              | Pros                                                                                  | Cons                                                                       |
| ------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Coolify**（选定） | 社区更大（49.8 万实例）；内置数据库备份到 S3；Server Automations 自动初始化；文档完善 | 2C2G 独占时内置 PG/Redis/Soketi 额外占 ~200–300 MB（资源充裕，不构成问题） |
| Dokploy             | PaaS 自身占用更低（~250 MB）；Build Server 分离更彻底                                 | 社区更小；Docker Swarm 在单节点增加复杂度                                  |

| Option                              | Pros                                                        | Cons                                  |
| ----------------------------------- | ----------------------------------------------------------- | ------------------------------------- |
| **VictoriaMetrics 放 2C4G**（选定） | localhost 抓取不走公网；`/metrics` 不暴露；不依赖公网连通性 | 2C4G 多跑 ~300 MB（资源充裕）         |
| 放 2C2G PaaS 服务器                 | 2C2G 资源更充分利用                                         | 必须走公网抓取 `/metrics`，暴露攻击面 |

| Option                            | Pros                                             | Cons                                             |
| --------------------------------- | ------------------------------------------------ | ------------------------------------------------ |
| **Traefik**（选定，Coolify 自带） | Coolify 自动管理；原生 SSE/WebSocket；自动 HTTPS | 无 `limit_conn`（应用层已覆盖）                  |
| 保留 Nginx                        | `limit_conn` 并发限制                            | 需手动维护 SSL/限流/SSE；与 Coolify 管理模型冲突 |

| Option                                               | Pros                                | Cons                                        |
| ---------------------------------------------------- | ----------------------------------- | ------------------------------------------- |
| **`config/default.yaml` + Zod `.default()`**（选定） | 显式声明 + 代码安全网；嵌套结构可读 | 需新增 YAML loader                          |
| `.env.defaults`                                      | 新开发者一眼看到默认值              | 扁平键值无法表达嵌套；与 Zod 出现两份默认值 |

## Consequences

### 变得更容易

- 配置可读性：YAML 嵌套结构比扁平 `.env` 清晰，按命名空间组织。
- 部署运维：Coolify 接管部署/回滚/健康检查/SSL/Traefik，不再维护 `deploy.ts`。
- 监控配置：VictoriaMetrics scrape 配置是静态 YAML（不含密钥），不再需要 `render-configs.sh`。
- 资源释放：2C4G 不再跑 Prometheus + Grafana（~1.15 GB），换为 VictoriaMetrics（~300 MB）。

### 变得更难 / 新增负担

- 需新建不依赖 Nest 的 YAML loader（deep merge + schema 校验 + 类型转换）。
- 现有配置工厂从 `process.env` 改为读取 Nest 配置对象。
- Dockerfile / Nest CLI 需配置 YAML 资产复制。
- Traefik 中间件需在 Coolify 面板手动配置（安全 headers、compress、`/metrics` 拒绝、`maxBodyBytes`）。
- Coolify 到 2C4G 的 SSH 走公网，需确保密钥认证和端口限制。
- Coolify 可能不提供 pre-deploy DB 快照，需确认或编写独立脚本。

### 不变

- Prisma CLI 独立加载 `.env`，读取 `process.env.DATABASE_URL`。
- `prom-client` 和 `/metrics` 端点不变，VictoriaMetrics 兼容 Prometheus exposition format。
- Zod schema `validateEnvironment` 启动校验保留，`.default()` 作为安全网。
- `NODE_ENV`、`OTEL_ENABLED`、`TRUST_PROXY` 等启动选择器继续由环境变量提供。
- OTel tracing（ADR-0010）不受影响。

## Cross-References

- 实施计划：`plans/env-yaml-evaluation-research.md`
- ADR-0004：部署模型（被取代）
- ADR-0006：可观测性策略（监控栈部分被取代）
- ADR-0010：OTel tracing（不受影响）
