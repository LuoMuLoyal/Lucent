---
status: pending
owner: backend
quadrant: plan
updated: 2026-08-24
---

# Lucent 部署重构计划：迁移到 Coolify + Traefik

> 前身：`2026-08-23-self-hosted-paas-research.md`（调研报告，2026-08-23）。
> 本文件在原调研结论基础上改写为实施计划。**此计划尚未最终通过，实施前需确认。**
> 不涉及配置格式迁移或可观测性栈变更——这两者有独立的计划文档。

## 状态

**待通过**。Coolify vs Dokploy 的选型在调研报告中推荐 Dokploy（7.5/10），但经项目方讨论，
在分机部署场景下（2C2G 独占 PaaS 管理节点，资源充裕），Coolify 的内置组件额外占用
（~200-300 MB）不构成问题，且 Coolify 社区更大、文档更完善、内置数据库备份到 S3。
最终选型为 **Coolify**，但尚未最终确认。

## 目标

从手写 `deploy.ts`（650 行、12 步流程）+ `compose.yml` + Nginx 迁移到 Coolify PaaS + Traefik。

## 服务器分配

两台服务器不处于内网，通过公网 SSH 通信。

| 机器 | 角色             | 组件                                                             | 预估 RAM    |
| ---- | ---------------- | ---------------------------------------------------------------- | ----------- |
| 2C2G | Coolify 管理节点 | Coolify 全套（UI + 内置 PG/Redis/Soketi + Traefik）+ OS + Docker | ~800-900 MB |
| 2C4G | 应用 + 监控      | Lucent + PostgreSQL + Redis + Victoria 可观测性栈 + Traefik + OS | ~1.3-1.5 GB |

## 决策

### 1. Coolify 部署在 2C2G 管理服务器

- 通过 SSH 远程管理 2C4G 应用服务器上的部署。
- Coolify 自带 Traefik，自动安装到每台被管理的服务器。
- CI（GitHub Actions）构建镜像推到 GitHub Container Registry，Coolify 只拉取部署，不在服务器上构建。

### 2. Nginx → Traefik

- Traefik 替代 Nginx（Coolify 自带，自动管理）。
- 接受能力降级：`limit_conn` 并发连接限制在 Traefik 中无原生等价物，由应用层 ThrottlerModule + SseConnectionRegistry 覆盖。
- Traefik 中间件需在 Coolify 面板中手动配置：安全 headers、compress、`/metrics` 拒绝、`maxBodyBytes`。

### 3. Nginx → Traefik 能力降级评估

| Nginx 能力                                 | Traefik 替代                                       | 降级影响                                                  |
| ------------------------------------------ | -------------------------------------------------- | --------------------------------------------------------- |
| `limit_req_zone` 速率限制 (20r/s burst=40) | Traefik 速率限制中间件                             | Lucent 已有 ThrottlerModule 应用层限流，Traefik 层可选    |
| `limit_conn_zone` 并发连接限制 (50)        | Traefik 无原生等价物                               | **降级**，但 Lucent SSE 有 SseConnectionRegistry 连接管理 |
| SSE 专用 location（`proxy_buffering off`） | Traefik 原生支持 SSE/WebSocket，自动禁用 buffering | 无降级                                                    |
| 安全 headers (HSTS, X-Frame-Options 等)    | Traefik headers 中间件                             | 无降级                                                    |
| Gzip                                       | Traefik compress 中间件                            | 无降级                                                    |
| `/metrics` 返回 403                        | Traefik 路由规则拒绝特定 path                      | 无降级                                                    |
| HTTP → HTTPS 301                           | Traefik 自动处理                                   | 无降级                                                    |
| `client_max_body_size 20m`                 | Traefik `maxBodyBytes` 选项                        | 无降级                                                    |

### 4. deploy.ts 12 步在 Coolify 下的去留

| 步骤                         | 现状               | Coolify 迁移后                           |
| ---------------------------- | ------------------ | ---------------------------------------- |
| 1. 前置检查 + render-configs | deploy.ts          | 退役（监控配置不再需要渲染）             |
| 2. 读旧镜像                  | deploy.ts          | Coolify 自动管理                         |
| 3. `.env` 快照               | deploy.ts          | Coolify 环境变量管理替代                 |
| 4. 起 postgres/redis         | deploy.ts          | Coolify 或 compose 管理                  |
| 5. 部署前 pg_dump 快照       | deploy.ts          | **保留**（Coolify 备份不保证在发布瞬间） |
| 6. stop app                  | deploy.ts          | Coolify 部署动作替代                     |
| 7. prisma migrate deploy     | deploy.ts 独立容器 | Coolify pre-deploy 命令或启动脚本        |
| 8. 更新 LUCENT_IMAGE         | deploy.ts          | Coolify 管理                             |
| 9. 健康门禁 ~150s            | deploy.ts          | Coolify 健康检查 + 失败回滚需验证        |
| 10. nginx reload             | deploy.ts          | 消失（Traefik 动态发现容器）             |
| 11. smoke test               | deploy.ts          | 保留为部署后手动/CI 步骤                 |
| 12. 通知                     | deploy.ts          | Coolify webhook 或保留脚本               |

### 5. 退役文件

- `deploy/deploy.ts`：Coolify 接管部署流程。
- `deploy/render-configs.sh`：监控配置不再需要渲染。
- `deploy/compose.yml`：拆分为基础设施 Compose 或由 Coolify 管理。
- `deploy/nginx/nginx.conf`：Coolify 自带 Traefik 替代。
- `deploy/backup.sh`：由 Coolify 内置数据库备份到 S3 替代。
- `deploy/prometheus/`、`deploy/grafana/`、`deploy/alertmanager/`：由 Victoria 可观测性栈替代（见独立计划）。

## 实施步骤

### Phase 1：Coolify 安装与服务器连接

1. 在 2C2G 管理服务器安装 Coolify。
2. 创建管理员账户，配置域名和 HTTPS。
3. 通过 Coolify 面板添加 2C4G 为远程服务器（SSH 连接），Coolify 自动安装 Traefik。

### Phase 2：CI 构建流程改造

1. 在 GitHub Actions 中构建 Docker 镜像，推到 GitHub Container Registry。
2. Coolify 配置为从 registry 拉取镜像部署，不在服务器上构建。

### Phase 3：部署配置迁移

1. 将 `deploy/compose.yml` 中保留的基础设施（postgres、redis）迁移到 Coolify 管理的数据库服务或独立 Docker Compose。
2. 应用容器由 Coolify 直接管理。
3. 配置 Traefik 中间件（在 Coolify 面板中配置）：
   - 安全 headers 中间件（HSTS、X-Frame-Options、X-Content-Type-Options 等）。
   - compress 中间件（Gzip）。
   - `/metrics` 路径拒绝规则（返回 403）。
   - SSE 路由保持默认（Traefik 原生支持 SSE/WebSocket）。
   - `maxBodyBytes` 限制为 20m。
   - HTTP → HTTPS 自动重定向（Coolify/Traefik 默认）。

### Phase 4：旧部署文件退役

1. 退役 `deploy/deploy.ts`、`deploy/render-configs.sh`、`deploy/compose.yml`、`deploy/nginx/nginx.conf`、`deploy/backup.sh`。
2. 退役 `deploy/prometheus/`、`deploy/grafana/`、`deploy/alertmanager/`（由可观测性迁移计划覆盖）。

### Phase 5：确认 DB snapshot / rollback 替代方案

1. 确认 Coolify 是否提供部署前数据库快照。
2. 确认 Coolify 的回滚能力（镜像级回滚 vs schema 回退）。
3. 如不足，编写轻量级 pre-deploy hook 脚本。

## 验证矩阵

- [ ] Coolify 在 2C2G 上安装成功，管理面板可访问。
- [ ] 2C4G 通过 SSH 添加为 Coolify 远程服务器，Traefik 自动安装。
- [ ] Coolify 从 registry 拉取镜像部署成功（不在服务器上构建）。
- [ ] Coolify 环境变量面板中的敏感值正确注入容器 `process.env`。
- [ ] Coolify 健康检查通过（`GET /api/v1/health`）。
- [ ] Coolify 回滚功能验证。
- [ ] Coolify SSL 证书自动管理验证。
- [ ] Traefik 安全 headers 中间件生效。
- [ ] Traefik `/metrics` 路径返回 403。
- [ ] Traefik SSE 路由正常工作（`proxy_buffering` 自动禁用）。
- [ ] Traefik `maxBodyBytes` 限制生效。
- [ ] Coolify 到 2C4G 的 SSH 走公网，密钥认证和端口限制已配置。

## 风险与回退

- **Coolify 不满足需求**：可回退到 Dokploy（资源占用更低）或精简后的 Compose 部署。
- **Traefik 并发连接限制缺失**：应用层 ThrottlerModule + SseConnectionRegistry 已覆盖。
- **公网 SSH 通信**：确保密钥认证、禁用密码登录、限制端口暴露。
- **DB snapshot 缺失**：Coolify 迁移期间可能缺少 pre-deploy 快照，需手动 `pg_dump` 或编写独立脚本。

## 关联文档

- 调研报告（已归档）：原 `2026-08-23-self-hosted-paas-research.md` 的调研内容保留在 `docs/03-archive/`。
- 配置迁移计划：`2026-08-24-config-yaml-migration-plan.md`。
- 可观测性迁移计划：`2026-08-24-observability-victoria-migration-plan.md`。
- ADR-0004：部署模型（将被此计划取代，待通过后写 ADR）。
