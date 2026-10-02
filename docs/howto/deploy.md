---
status: active
owner: backend
quadrant: howto
updated: 2026-10-02
---

# How-To: 部署 Lucent

部署模型与组件说明见 [reference/deployment.md](../reference/deployment.md),本文只给操作步骤。

三台机器各跑一份仓库内 compose:

| 机器                  | 角色                 | 工作目录                 | compose                   | 服务                                                        |
| --------------------- | -------------------- | ------------------------ | ------------------------- | ----------------------------------------------------------- |
| 主站(华为云, aarch64) | Lucent + 数据 + 检索 | `/opt/lucent`            | `compose.yaml`            | `postgres` `redis` `app` `lightrag` `node-exporter`         |
| 图库机(腾讯云, amd64) | 英文侧 OAG           | `/opt/lucent-neo4j`      | `compose.yaml`            | `neo4j` `semantica`                                         |
| 监控机(阿里云, amd64) | 指标/日志/追踪       | `/opt/lucent-monitoring` | `compose.monitoring.yaml` | `victoriametrics` `grafana` `victorialogs` `victoriatraces` |

> 🔒 **本文用占位符,不写真实地址。** `<主站IP>` / `<图库IP>` / `<监控IP>` 与各端口
> 的安全组规则属运维信息,在服务器侧 `.env` 与私有运维笔记中维护(仓库可能公开)。
>
> ⚠️ **跨云地址一律填对方公网 IP。** 三家云之间无 VPC 对等,填内网地址的失败形态是
> **超时**(不是连接拒绝),表现为相应能力静默降级。安全组按对方**公网出口 IP** 白名单
> (三家均 1:1 NAT,出口 IP == 公网 IP)。

## 一、主站(华为云 鲲鹏)

### 首次接入

1. **确认 Docker**:

   ```bash
   docker --version && docker compose version
   ```

2. **建工作目录并放入编排与配置**:

   ```bash
   mkdir -p /opt/lucent && cd /opt/lucent
   cp /path/to/compose.yaml .
   cp .env.production.example .env && vim .env      # 填值,清单见 §四
   mkdir -p deploy/lightrag
   cp deploy/lightrag/.env.example deploy/lightrag/.env && vim deploy/lightrag/.env
   ```

3. **拉镜像**(主站要 `linux/arm64` 标签):

   ```bash
   docker compose pull postgres redis lightrag node-exporter app
   ```

4. **给两个数据库建 `vector` 扩展**(镜像自带 `vector`,但扩展是按库启用的):

   ```bash
   docker compose up -d postgres && sleep 10
   docker compose exec postgres psql -U lucent -d lucent   -c 'CREATE EXTENSION IF NOT EXISTS vector;'
   docker compose exec postgres psql -U lucent -d lightrag -c 'CREATE EXTENSION IF NOT EXISTS vector;'
   ```

   > 漏掉 `lucent` 库这一步的后果:向量表建不出来,英文侧 `search_drugbank_passages`
   > 静默返回空。`lightrag` 库通常由 LightRAG 自己建,但显式建一次无害。

5. **起全部服务**:

   ```bash
   docker compose up -d
   docker compose ps                      # 等 postgres/redis healthy
   docker logs lucent-app-1 | tail -30    # entrypoint 会跑 prisma migrate deploy
   ```

6. **验证**:

   ```bash
   curl -fsS http://127.0.0.1:3000/api/v1/health/deep
   curl -fsS http://<主站IP>:3000/api/v1/health/deep      # 公网入口
   ```

### 日常发布

```bash
cd /opt/lucent

# 1) 换镜像引用(改这一处即可;完整引用含短 sha 与架构后缀)
vim .env                     # LUCENT_IMAGE=<registry>/lucent:<新短sha>-arm64

# 2) 拉取并重建(up -d 不会拉新镜像,也不会重建容器)
docker compose pull app
docker compose up -d --force-recreate app

# 3) 健康门禁(entrypoint 失败则容器不启动,这一步能立刻看出)
for i in $(seq 1 30); do curl -fsS http://127.0.0.1:3000/api/v1/health/ready && break; sleep 2; done
```

- `--force-recreate` 不能省:改 `.env` 后 `up -d` 看到容器已存在就什么都不做,
  **环境变量与镜像都不会更新**。
- 停机窗口 = app 容器重建时间(约 15–45s)。
- **回滚**:把 `LUCENT_IMAGE` 改回旧短 sha,重跑同一串命令。

### 改 sidecar 配置

`deploy/lightrag/.env` 改动后**必须重建容器**:

```bash
cd /opt/lucent
docker compose up -d --force-recreate lightrag
docker logs lucent-lightrag-1 --tail 50 | grep -i 'dimension\|model'   # 确认真的生效
```

> ⚠️ 两个高频坑:① `up -d` 不重建,配置静默不生效;② pipeline 忙时重启会中断
> 正在解析的文档(`recovery_required`),先确认空闲再动手。

### 基础设施变更

```bash
cd /opt/lucent
# 更新 compose.yaml 后
docker compose up -d
docker compose ps
```

## 二、图库机(腾讯云 Neo4j + semantica)

工作目录 `/opt/lucent-neo4j`,用**同一份 `compose.yaml`** 起两个服务。

```bash
cd /opt/lucent-neo4j
vim .env                     # NEO4J_PASSWORD / API_TOKEN / SEMANTICA_IMAGE
docker compose up -d neo4j          # 先起图库
docker compose ps                   # 等 neo4j healthy
docker compose up -d semantica      # 再起 sidecar
```

> ⚠️ `API_TOKEN`(sidecar 侧)必须与主站 app 的 `SEMANTICA_API_KEY` **一致**,
> 否则 401。`semantica` 带 `profiles: ['semantica']`,不经 profile 调用会提示服务不存在。

验证(**从主站侧**验证跨云可达才有意义):

```bash
# 主站上执行
curl -fsS http://<图库IP>:8099/health
```

> ⚠️ `/health` **不校验鉴权**,不能用它判断 key 是否配对。要验鉴权得打一个受保护端点。

发布新 sidecar 镜像:

```bash
cd /opt/lucent-neo4j
docker compose pull semantica
docker compose up -d --force-recreate semantica
```

## 三、监控机(阿里云)

工作目录 `/opt/lucent-monitoring`。

```bash
cd /opt/lucent-monitoring
vim .env                     # LUCENT_PUBLIC_HOST=<主站IP> / METRICS_* / GRAFANA_ADMIN_PASSWORD
                             # + 告警那组: ALERT_EMAIL_TO / MAIL_* / GF_SMTP_ENABLED
docker compose up -d
docker compose ps
```

验证:

```bash
# 1) VM 真的抓到了主站(两个 job 都要 up)
curl -fsS 'http://127.0.0.1:8428/api/v1/targets' | grep -o '"health":"[a-z]*"' | sort | uniq -c
# 2) 有指标进来(非空)
curl -fsS 'http://127.0.0.1:8428/api/v1/query?query=up' | head -c 300
# 3) Grafana 能查到同一份数据
curl -fsS -u "$METRICS_USER:$METRICS_PASSWORD" 'http://127.0.0.1:3001/api/health'
```

`LUCENT_PUBLIC_HOST` 改 IP 时,必须**同步**改主站 `.env` 的 `PUBLIC_BASE_URL`
——它们是同一事实的两处表达。

### 告警(邮件)

规则/联系点/通知策略随 `monitoring/grafana/provisioning/` 一起部署,`docker compose up -d`
(或重建 grafana)即装载,**不需要进 Grafana UI 手工配**。改 `.env` 里的发信那组后必须
**重建 grafana 容器**才生效(`GF_SMTP_*` 是启动时读的环境变量):

```bash
docker compose up -d --force-recreate grafana
```

验证装载与真实发信:

```bash
PW=$(grep '^GRAFANA_ADMIN_PASSWORD=' /opt/lucent-monitoring/.env | cut -d= -f2)

# 1) 12 条规则都装进来了(provenance 应为 file,即来自文件而非 UI)
curl -fsS -u "admin:$PW" 'http://127.0.0.1:3001/api/v1/provisioning/alert-rules' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d), "条")'

# 2) 联系点地址已从 $ALERT_EMAIL_TO 插值展开成真实邮箱
curl -fsS -u "admin:$PW" 'http://127.0.0.1:3001/api/v1/provisioning/contact-points'

# 3) 真实发一封测试信(走 smtp.qq.com),status 应为 ok
curl -fsS -X POST -u "admin:$PW" -H 'Content-Type: application/json' \
  -d '{"receivers":[{"name":"lucent-email","grafana_managed_receiver_configs":[{"uid":"lucent_email_alert","name":"lucent-email","type":"email","settings":{"addresses":"<收件邮箱>","singleEmail":false}}]}],"alert":{"annotations":{"summary":"self-test"},"labels":{"alertname":"SelfTest","severity":"critical"}}}' \
  'http://127.0.0.1:3001/api/alertmanager/grafana/config/api/v1/receivers/test'
```

⚠️ 四点易错处:

- `GF_SMTP_ENABLED` 默认是 **false**,此时 Grafana **静默丢弃**邮件通知——告警照常触发、
  状态页照常变红,却一封都不发。判据是上面第 3 步:真发了才有 `"status":"ok"`。
- 联系点地址若仍是 `<example@email.com>`,说明 provisioning 没生效(那是 Grafana 内置默认
  联系点),用第 2 步核对。
- 只挂规则文件而忘记发信那组变量时,邮件会以 `example@email.com` 为收件人发出并被退信。
  该默认值来自 Grafana 自带 contact point,不是本仓库的配置。
- **收到大量 `DatasourceNoData` 邮件**(标题里的名字不是 12 条规则中任何一条)说明规则
  在健康态下**查询返回空集**:Grafana 会为每条进 NoData 的规则自动生成 `DatasourceNoData`
  告警并触发通知。修法是给 PromQL 补哨兵使其恒有值,同时 `noDataState` 设 `OK`。
  ⚠️ 哨兵**必须写 `or on() vector(...)`**,不能写 `or vector(...)`:`or` 在左操作数带标签时
  是**并集**,带标签的序列会把无标签哨兵一并留下,阈值方向相反时立刻误报
  (实测 `up{job="lucent"} or vector(0)` 同时返回 `up=1` 与 `=0`,配 `lt 1` 直接假报 LucentDown)。
  核对是否复发:

  ```bash
  curl -s -u "admin:$PW" 'http://127.0.0.1:3001/api/alertmanager/grafana/api/v2/alerts' \
    | python3 -c 'import json,sys,collections; d=json.load(sys.stdin); print(collections.Counter(a["labels"]["alertname"] for a in d))'
  # 期望:Counter()  —— 全部 inactive,无 DatasourceNoData
  ```

## 四、「改哪些值」清单

### 主站 `/opt/lucent/.env`

| 键                                     | 值 / 说明                                                                                                      |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `LUCENT_IMAGE`                         | `<registry>/lucent:<短sha>-arm64`                                                                              |
| `LUCENT_DB_IMAGE`                      | `<registry>/lucent-db:18-arm64`                                                                                |
| `POSTGRES_PASSWORD` / `REDIS_PASSWORD` | compose 插值用;**必须与 `DATABASE_URL`/`REDIS_URL` 内嵌口令一致**                                              |
| `PUBLIC_BASE_URL`                      | `http://<主站IP>:3000`                                                                                         |
| `CORS_ORIGIN`                          | 当前 `*`;收紧时改成客户端来源                                                                                  |
| `TRUST_PROXY`                          | `false`(当前无反代;接入反代后改 `true`)                                                                        |
| `SEMANTICA_BASE_URL`                   | `http://<图库IP>:8099`(公网)                                                                                   |
| `VICTORIALOGS_URL`                     | `http://<监控IP>:9428/insert/jsonline`(公网)                                                                   |
| `OTEL_EXPORTER_OTLP_ENDPOINT`          | `http://<监控IP>:10428/insert/opentelemetry/v1/traces`                                                         |
| `METRICS_USER` / `METRICS_PASSWORD`    | app `/metrics` 的 Basic Auth + VM 抓取凭据                                                                     |
| 其余密钥                               | JWT / ADMIN / 邮件 / AI / 对象存储 / 推送,见 [environment-variables.md](../reference/environment-variables.md) |

### 主站 `/opt/lucent/deploy/lightrag/.env`

| 键                                                            | 值 / 说明                                                                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `EMBEDDING_MODEL`                                             | `text-embedding-v4`                                                                                                       |
| `EMBEDDING_DIM` / `EMBEDDING_SEND_DIM`                        | `768` / `true`;**必须与 app 的 `AI_EMBEDDING_DIMENSION` 相等**,`SEND_DIM` 非 `true` 时 API 返回原生 1024 维导致维度不匹配 |
| `EXTRACT_LLM_MODEL` / `KEYWORD_LLM_MODEL` / `QUERY_LLM_MODEL` | 抽取/关键词/查询三侧模型;改后必须重建容器                                                                                 |
| `ENTITY_TYPE_PROMPT_FILE`                                     | 实体类型提示词档案(如 `lumos_medicine.yml`);改后必须重建容器                                                              |
| `MAX_ASYNC_LLM`                                               | 并发抽取上限                                                                                                              |

### 图库机 `/opt/lucent-neo4j/.env`

| 键                | 值 / 说明                                   |
| ----------------- | ------------------------------------------- |
| `NEO4J_PASSWORD`  | 与容器 `NEO4J_AUTH` 一致                    |
| `API_TOKEN`       | **必须等于**主站 app 的 `SEMANTICA_API_KEY` |
| `SEMANTICA_IMAGE` | `<registry>/lucent-semantica:latest-amd64`  |
| `NEO4J_IMAGE`     | `neo4j:5.26.31-community`                   |

### 监控机 `/opt/lucent-monitoring/.env`

| 键                                                                  | 值 / 说明                                       |
| ------------------------------------------------------------------- | ----------------------------------------------- |
| `LUCENT_PUBLIC_HOST`                                                | `<主站IP>`;改它必须同步改主站 `PUBLIC_BASE_URL` |
| `METRICS_USER` / `METRICS_PASSWORD`                                 | 抓主站 `/metrics` 的凭据,须与主站侧一致         |
| `GRAFANA_ADMIN_PASSWORD`                                            | Grafana 管理员口令                              |
| `ALERT_EMAIL_TO`                                                    | 告警收件邮箱;联系点读 `$ALERT_EMAIL_TO` 展开    |
| `MAIL_HOST` / `MAIL_PORT` / `MAIL_USER` / `MAIL_PASS` / `MAIL_FROM` | 发信账号,映射成 `GF_SMTP_*`;须与主站侧一致      |
| `GF_SMTP_ENABLED`                                                   | `true`;设为 `false` 会**静默丢弃**邮件通知      |

## 五、安全组

**端口发布到 `0.0.0.0` 不等于对全网开放**——云安全组按来源 IP 白名单收口,限定到指定 IP 后
可达性等同于「只有该 IP 能连」。按**流量方向**决定往哪边开:

| 端口                               | 所在机器 | 放行对象                                  |
| ---------------------------------- | -------- | ----------------------------------------- |
| `3000`                             | 主站     | 公网(客户端入口)                          |
| `9100`                             | 主站     | 监控机出口 IP;⚠️ **绝不放行 `0.0.0.0/0`** |
| `5432` / `6379` / `9621`           | 主站     | 运维 IP                                   |
| `7687` / `7474` / `8099`           | 图库机   | 运维 IP;`8099` 另放行主站出口 IP          |
| `8428` / `3001` / `9428` / `10428` | 监控机   | 运维 IP                                   |

**具体 IP 值与规则清单在私有运维笔记中维护,不入库。**

比本机直连更严的做法是开 SSH 隧道(端口不必对任何 IP 放行):

```bash
ssh -N -L 8428:127.0.0.1:8428 -L 9428:127.0.0.1:9428 \
    -L 3001:127.0.0.1:3001 root@<监控IP>
```

## 六、注意

- **无 TLS**:入口是 HTTP 明文,`METRICS_*` 与 sidecar bearer token 跨云明文过线。
- **备份未启用**:当前无自动备份,勿在未验证恢复路径的情况下做破坏性操作。
- **告警未配置**。
- **多机 `.env` 是漂移源**:新增变量要逐台补,没有集中式配置源。
- **跨云是硬依赖**:图库机或监控机不可达时英文侧 OAG / 日志 / 追踪相应降级,
  LightRAG 与主流程不受影响。
- **数据库迁移随容器启动执行**(`entrypoint.sh`),失败则容器不启动;schema 不回退。
