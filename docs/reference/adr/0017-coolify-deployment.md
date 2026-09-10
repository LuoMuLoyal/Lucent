# ADR-0017: Coolify 部署模型(仓库 compose + Docker Hub 镜像)

- **Status**: accepted (amended 2026-09-10: staging 迁出 Coolify,改为宿主原生
  PM2 + 自建 Traefik + 推送即部署;下文 Coolify 模型继续适用于 production)
- **Date**: 2026-09-08
- **Deciders**: LuoMuLoyal

## Context

ADR-0004 定义了 GitHub Actions + 腾讯 TCR + SSH `deploy.ts` 的单机 Compose 部署
模型(单 slot 停机发布、Nginx 反代、本地证书、`backup.sh`/`check-cert.sh`/
告警栈)。该模型运维面过宽:

- 反向代理、TLS 证书、发布/回滚、健康门禁全部自维护(`deploy.ts` 650 行 +
  Nginx + 证书脚本);
- 现场(服务器侧)构建属 Docker 反模式,应改为 CI 构建、registry 拉取;
- 引入 Coolify(自带 Traefik 与被管服务器 Agent)后,nginx、证书检查、
  告警与备份脚本均可由平台或简化配置替代。

## Decision

采用 **仓库保留一份生产 compose + Coolify 注册为 Docker Compose Service** 的模型:

1. **编排事实源留在仓库**:`compose.yaml` 定义完整栈 —— `postgres`、
   `redis`、`app`、`victoriametrics`、`grafana`、`victorialogs`、`node-exporter`。
   Nginx、vmalert、alertmanager、`deploy.ts`/`smoke.ts`/`backup.sh`/
   `check-cert.sh`/`render-configs.sh` 与告警规则全部退役。
2. **Coolify 负责执行**:compose 粘贴为 Coolify 的 Docker Compose Service,
   由 Coolify 在被管服务器 `docker compose up`;Coolify 自带 Traefik 接管
   域名路由与 TLS 证书(app 组件配 domain 即可),容器日志与终端在面板查看。
3. **镜像**:GitHub Actions(CI 不变)的 CD 只做 build + push 到发布者自有
   镜像仓库 —— 仓库名由 GitHub secret `REGISTRY_IMAGE` 注入(公开仓库代码
   不写死用户名),tag 为 `<git sha 前 8 位>`(另推 `latest`);compose 以
   `${LUCENT_IMAGE}`(完整镜像引用)选择;发版 = 更新该变量并
   Pull Latest Images & Restart。现场构建不再使用。
4. **日志**:只写 stdout(容器/Coolify 收集)+ VictoriaLogs(`VICTORIALOGS_URL`
   由 compose 注入),不写文件系统、不挂日志卷。
5. **告警与备份当前不做**:告警组件与规则退役;数据库自动备份暂不启用
   (后续可在 Coolify postgres 组件开启 S3 备份)。保留指标栈
   (VictoriaMetrics + Grafana),端口 3001/8428/9428 直接发布,公网访问
   由云安全组收口(替代 SSH 隧道)。
6. **数据库迁移**:schema 变更时,发布前在 app 容器内执行一次
   `node_modules/.bin/prisma migrate deploy`;schema 不回退,
   破坏性迁移继续遵守 expand-contract。

## Options Considered

| Option                                            | Pros                                            | Cons                                                                          |
| ------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------- |
| 全部 Coolify 资源纳管(Application + DB Service)   | UI 部署/回滚/备份齐备                           | 编排与配置散落 UI,仓库无单一事实源;迁移步骤依赖 Application post-deploy 钩子  |
| 仓库单 compose + Coolify 注册为 Service(**采纳**) | 编排可版本化、单一事实源;Coolify 只管执行与反代 | compose 资源的面板操作(改 tag/重启)比 Application 略手动;环境变量需在面板维护 |
| 服务器现场构建(Coolify Git/Dockerfile 源)         | 接入最快                                        | 构建反模式:服务器负载与状态、缓存不可控(staging 早期文档做法,弃用)            |

## Consequences

- 公网入口只有 Coolify Traefik:nginx、`certs/`、`check-cert.sh`、Nginx 层
  限流/拦截等全部移除,HTTPS 续期自动。
- 运维动词收敛:发版 = 改 `LUCENT_IMAGE` 完整引用 + pull & restart;回滚 = 改回
  旧短 sha 的完整引用。
- `/metrics` Basic Auth(`METRICS_USER`/`METRICS_PASSWORD`)保留为可选;
  抓取在 Docker 内网完成。公网暴露 `/metrics` 由 Traefik/安全组约束。
- 部署文档、环境变量文档、GitHub secrets(TCR/SSH → Docker Hub)同步更新;
  数据库备份能力空缺需在上生产前补齐(Coolify 备份或运维 pg_dump)。

---

## Amendment 2026-09-10: staging 迁出 Coolify(原生 PM2 + 自建 Traefik + 推送即部署)

### Context

上述模型对 staging 过重:Coolify 控制面、部署 webhook、Docker Hub 镜像、Coolify 自带
Traefik 四层耦合,只为跑一个单实例 staging;staging 既不需要镜像化回滚锚点,也不需要
平台面板。服务器侧已卸载 Coolify(80/443 空闲),且无需要保留的数据。

### Decision

staging 改为「宿主原生进程 + 自管容器基础设施」,production 保持本文前述 Coolify 模型:

1. **应用原生运行**:Node 24 + PM2(`deploy/ecosystem.config.cjs`,`root` 用户,
   代码目录 `/opt/lucent`),不再为 staging 构建镜像。
2. **基础设施自管**:根 `compose.staging.yaml` 只跑 postgres / redis / victoriametrics /
   victorialogs / traefik,端口全部绑 `127.0.0.1`,公网只经 Traefik(80/443)进出。
3. **反代 / TLS 自管**:Traefik 容器 + file provider,配置在 `deploy/traefik/`
   —— 仓库只跟踪 `.example` 模板,真实文件(gitignored)在服务器上维护,避免发布时
   `git reset --hard` 覆盖运行配置;API 域名直通宿主 `3000`,三个面板
   (VictoriaMetrics VMUI / VictoriaLogs UI / Traefik dashboard)经路由 + BasicAuth 暴露。
4. **推送即部署**:`lucent-staging` 由 `push`(main)直接触发(不等 `lucent-ci` 结果),
   SSH 到服务器执行 `pm2 stop → git reset --hard origin/main → pnpm install →
prisma:generate + build → prisma migrate deploy → pm2 startOrReload → 健康门禁`;
   手动发布就是同一串命令。
5. **不做回滚**:fix-forward,必要时手动 `git checkout <旧 sha>` 重跑同一串命令;
   schema 不回退,破坏性变更继续 expand-contract。
6. **编排与配置留根目录**:compose 与 `.env.production` 都在仓库根(服务器即完整 clone),
   `.env.production` 单文件同时供 app 与 compose 插值读取。

### Options Considered

| Option                                            | Pros                                               | Cons                                                                 |
| ------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------- |
| 维持 Coolify(staging 也用 compose Service)        | 与 production 同构、面板可视                       | 为单实例 staging 背整套控制面;webhook + 镜像 + 自带 Traefik 四层耦合 |
| staging 用 Coolify Application + post-deploy 钩子 | 面板一键部署                                       | 编排 / 迁移 / 域名散落 UI,仓库失去单一事实源                         |
| 宿主原生 PM2 + 自管 Traefik(**采纳**)             | 组件最少、链路最短、CI 与手动同源;staging 无需镜像 | 与 production 模型分叉;停机发布(停机窗口含构建);无回滚锚点           |

### Consequences

- **模型分叉**:同一份代码两条发布路径,文档必须分别说明
  (`docs/reference/deployment.md`、`docs/howto/deploy.md`)。
- **secrets 换血**:`COOLIFY_STAGING_WEBHOOK` 退役;新增 `STAGING_SSH_*` secrets 与
  `STAGING_API_HOST` variable;`DOCKERHUB_*` / `REGISTRY_IMAGE` 只服务 production。
- **镜像 tag 策略收窄**:staging 不再推 `latest`,该约定作废;production 只推短 sha 不变。
- **未经 CI 校验即上线**:推送即部署的必然结果,staging 的失败靠下一条提交修复。
- **暴露面变化**:staging 的域名 / TLS / 端口暴露从「Coolify 托管 + 云安全组收口」
  变为「Traefik 自管 + 容器端口只绑回环」。
