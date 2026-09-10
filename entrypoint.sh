#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# Lucent 容器启动入口(生产镜像)。
#
# 职责:
#   1. 启动前执行 `prisma migrate deploy`(应用数据库迁移)。
#      失败时按指数重试(默认 10 次 × 5s),最终失败则退出 —— 绝不在
#      schema 未就绪时带病启动应用。
#   2. 迁移就绪后 `exec node dist/main.js` 启动应用(exec 使 node 成为
#      tini 的直接子进程,信号转发与僵尸回收语义与旧 ENTRYPOINT 一致)。
#
# 前提:
#   - 工作目录为 /app(镜像 WORKDIR),prisma.config.ts / prisma/ /
#     node_modules 均在当前目录下。
#   - DATABASE_URL 由编排(compose environment)注入;缺失时
#     prisma.config.ts 会抛错 → migrate 失败 → 容器退出,符合预期。
# ─────────────────────────────────────────────────────────────────────────────
set -e

MAX_RETRIES="${MIGRATE_MAX_RETRIES:-10}"
RETRY_DELAY="${MIGRATE_RETRY_DELAY:-5}"

echo "[entrypoint] applying database migrations (prisma migrate deploy)..."
attempt=1
until node_modules/.bin/prisma migrate deploy; do
  status=$?
  if [ "$attempt" -ge "$MAX_RETRIES" ]; then
    echo "[entrypoint] prisma migrate deploy failed after ${MAX_RETRIES} attempts (exit ${status}); aborting startup." >&2
    exit "$status"
  fi
  echo "[entrypoint] prisma migrate deploy failed (exit ${status}); retry ${attempt}/${MAX_RETRIES} in ${RETRY_DELAY}s..." >&2
  attempt=$((attempt + 1))
  sleep "$RETRY_DELAY"
done

echo "[entrypoint] migrations applied; starting lucent app."
exec node dist/main.js
