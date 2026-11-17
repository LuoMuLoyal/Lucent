#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# Lucent 容器启动入口(生产镜像)。
#
# 职责:
#   1. 启动前执行 `prisma migrate deploy`(应用数据库迁移)。
#      失败时按指数重试(默认 10 次 × 5s),最终失败则退出 —— 绝不在
#      schema 未就绪时带病启动应用。
#   2. 迁移就绪后 `exec node apps/monolith/dist/main.js` 启动应用(exec 使 node 成为
#      tini 的直接子进程,信号转发与僵尸回收语义与旧 ENTRYPOINT 一致)。
#
# 前提:
#   - 工作目录为 /app(镜像 WORKDIR),apps/monolith/prisma.config.ts / prisma/ /
#     node_modules 均在当前目录下。
#   - DATABASE_URL 由编排(compose environment)注入;缺失时
#     prisma.config.ts 会抛错 → migrate 失败 → 容器退出,符合预期。
# ─────────────────────────────────────────────────────────────────────────────
set -e

MAX_RETRIES="${MIGRATE_MAX_RETRIES:-10}"
RETRY_DELAY="${MIGRATE_RETRY_DELAY:-5}"

echo "[entrypoint] applying database migrations (prisma migrate deploy)..."
attempt=1
until apps/monolith/node_modules/.bin/prisma migrate deploy; do
  status=$?
  if [ "$attempt" -ge "$MAX_RETRIES" ]; then
    echo "[entrypoint] prisma migrate deploy failed after ${MAX_RETRIES} attempts (exit ${status}); aborting startup." >&2
    exit "$status"
  fi
  echo "[entrypoint] prisma migrate deploy failed (exit ${status}); retry ${attempt}/${MAX_RETRIES} in ${RETRY_DELAY}s..." >&2
  attempt=$((attempt + 1))
  sleep "$RETRY_DELAY"
done

echo "[entrypoint] migrations applied."

# Mem0 sidecar 的两个 database + pgvector 扩展。`CREATE DATABASE` 不能进事务、
# 也不能对着不存在的库执行，所以它不放进 prisma 迁移；放在这里是因为这是
# 「数据存储就绪」的唯一入口，每次启动都跑一遍（每条语句都先做存在性检查，
# 幂等）。MEM0_ENABLED 不为 true 时脚本直接返回。
#
# 为什么不放 docker/postgres 的 initdb 目录：那套只在**数据目录为空**时执行，
# 存量卷全都已初始化，会静默跳过——正是最需要它的地方失效。
#
# 放在 apps/monolith/scripts 下是因为它 import `pg`（该 workspace 成员的依赖），
# pnpm 只链进 apps/monolith/node_modules；上面 prisma 也走同一个目录。
if [ "${MEM0_ENABLED}" = "true" ]; then
  echo "[entrypoint] ensuring mem0 sidecar databases..."
  node apps/monolith/scripts/db/ensure-mem0-databases.ts
fi

echo "[entrypoint] starting lucent app."
exec node apps/monolith/dist/main.js
