# How-To: 数据库备份恢复演练

备份只有在能恢复时才有价值。本文给出从 `pg_dump` 备份恢复数据库的完整流程，用于：

- **每季度一次的恢复演练**（在 staging 上执行，验证备份可用性并计时）
- **生产灾难恢复**（磁盘故障、误操作后的实际恢复，流程相同，风险自担）

备份链路与文件布局见 [[../deployment]] 的「数据库备份」一节。

## 备份文件来源

| 来源         | 位置                                           | 保留策略                  |
| ------------ | ---------------------------------------------- | ------------------------- |
| 每日备份     | `/opt/lucent/data/backups/daily-*.sql.gz`      | 本地最近 7 份             |
| 部署前快照   | `/opt/lucent/data/backups/pre-deploy-*.sql.gz` | 本地最近 10 份            |
| COS 异地副本 | `cos://<COS_BUCKET>/backups/daily-*.sql.gz`    | bucket 生命周期规则 30 天 |

RPO 预期：日常故障最多丢失 24h 数据（每日备份）；发布事故可回到部署前快照点。

## 恢复演练（staging，每季度一次）

### 1. 选择并准备备份文件

```bash
cd /opt/lucent
ls -lh data/backups/
```

如需从 COS 取异地副本（验证异地链路时做这个，不要每次都从本地拿）：

```bash
coscli cp cos://<COS_BUCKET>/backups/daily-<ts>.sql.gz ./data/backups/restore-drill.sql.gz
```

校验文件完整性（gzip 自检 + 非空）：

```bash
gzip -t data/backups/<file>.sql.gz && echo OK
```

### 2. 停 app，重建 schema

`pg_dump` 的 plain 格式不包含 DROP 语句，直接灌入非空库会报对象已存在，因此先清库：

```bash
docker compose stop app

docker exec lucent-postgres psql -U lucent -d lucent -c \
  'DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO lucent; GRANT ALL ON SCHEMA public TO public;'
```

### 3. 灌入备份并计时

```bash
time (gunzip -c data/backups/<file>.sql.gz \
  | docker exec -i lucent-postgres psql -U lucent -d lucent -v ON_ERROR_STOP=1 -q)
```

`ON_ERROR_STOP=1` 保证任何一条语句失败即中止并暴露错误，而不是静默跳过。`pg_dump`
输出中的 `CREATE EXTENSION IF NOT EXISTS vector` 会自动重建 pgvector 扩展。

记录耗时——它是生产灾难恢复 RTO 估算的依据。

### 4. 验证

```bash
# 行数抽查（对比备份前后的量级，不要求精确一致——staging 数据可能已演进）
docker exec lucent-postgres psql -U lucent -d lucent -c \
  'SELECT count(*) FROM "User"; SELECT count(*) FROM "UserDailyRecord";'

# migration 状态应与备份时的代码版本一致；如有出入，启动 app 前先对齐镜像版本
docker exec lucent-postgres psql -U lucent -d lucent -c \
  'SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5;'

# 启动 app 并过健康检查
docker compose up -d app
curl http://127.0.0.1/api/v1/health/ready
```

再跑一次 smoke test 做业务级确认：

```bash
node smoke.ts
```

### 5. 记录演练结果

把以下信息记进当日迁移日志（`docs/02-logs/migration-log/YYYY-MM-DD.md`）：

- 演练日期、所用备份文件（来源：本地 / COS）、文件大小
- 灌入耗时（`time` 输出）与验证结果
- 发现的问题及修复动作（如备份脚本缺陷、链路不通）

## 生产灾难恢复

流程与演练完全相同，差异只有：

1. **先止血**：确认 postgres 容器已用持久化卷重新拉起（`data/postgresql` 目录仍在或
   已从新盘重建），再执行步骤 2-4
2. **选最新的可用备份**：优先本地 `daily-` 最新份；本地盘丢失时从 COS 下载
3. **恢复后评估 schema 漂移**：备份点之后的 migration 可能已在代码里但不在数据里。
   恢复完成后用当前镜像手动跑一次 migrate 补齐：

   ```bash
   cd /opt/lucent
   LUCENT_IMAGE=$(grep '^LUCENT_IMAGE=' .env | cut -d= -f2) node deploy.ts
   ```

   （deploy.ts 会重新走完整流程：快照 → migrate → 健康门禁 → smoke。）

4. **通知相关方**：数据回退到备份点意味着之后的写入丢失，按事故流程通报

## 注意事项

- 恢复是**清库重灌**：`DROP SCHEMA public CASCADE` 会删除现有全部数据，确认目标环
  境无误后再执行，生产操作前再确认一次当前确有更新的快照可用
- `backup.sh` 的 COS 上传是 best-effort 之外的关键链路：演练时至少每季度验证一次
  COS 下载可用（步骤 1），异地副本不可用等于没有异地副本
- 灌入期间 postgres 负载较高，演练也选低峰时段
