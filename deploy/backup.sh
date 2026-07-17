#!/bin/sh
# =============================================================================
# backup.sh — Lucent PostgreSQL 日常备份（本地保留 + 可选 COS 异地副本）
#
# 流程：
#   1. docker exec lucent-postgres pg_dump | gzip
#        → ./data/backups/daily-<yyyymmdd-hhmmss>.sql.gz
#   2. 本地只保留最近 7 份 daily-*.sql.gz
#      （deploy.ts 的 pre-deploy-*.sql.gz 快照互不影响）；
#   3. 若 ./.env 配置了 COS_BUCKET/COS_REGION/COS_SECRET_ID/COS_SECRET_KEY，
#      且系统装有 coscli 或 coscmd（coscli 优先），上传到 COS 的 backups/ 前缀。
#
# COS 侧 30 天保留：本脚本不做 COS 清理。请在 COS 控制台为该 bucket 配置
#   生命周期规则：前缀 backups/，30 天后过期删除。
#
# 首次配置上传工具（二选一，coscli 优先）：
#   a) coscli（推荐）：下载 https://github.com/tencentyun/coscli 后执行
#         coscli config init
#      交互式填入 SecretId / SecretKey / Bucket / Region，生成 ~/.cos.yaml；
#      脚本调用 coscli 时不再传密钥。
#   b) coscmd：pip install coscmd；无需配置文件，脚本从 .env 读取密钥传参。
#   注意：COS_BUCKET 必须是完整的 <BucketName-APPID>。
#
# 恢复示例（会先清库重灌，谨慎操作）：
#   gunzip -c ./data/backups/daily-20260716-031700.sql.gz \
#     | docker exec -i lucent-postgres psql -U lucent -d lucent
#
# cron 示例（每日 03:17）：
#   17 3 * * * cd /opt/lucent && ./backup.sh >> ./logs/backup.log 2>&1
#
# 运行环境：/opt/lucent 下运行（相对路径）；需要 docker、gzip；POSIX sh。
# 失败时退出码非零并向 stderr 打印清晰错误。
# =============================================================================
set -eu

BACKUP_DIR="./data/backups"
KEEP=7
CONTAINER="lucent-postgres"

fail() {
  echo "[backup] ERROR: $1" >&2
  exit 1
}

# 从 ./.env 读取某个变量值；文件或键不存在时输出空字符串。
env_value() {
  key="$1"
  [ -f ./.env ] || return 0
  line=$(grep -E "^${key}=" ./.env | tail -n 1 || true)
  [ -n "$line" ] || return 0
  printf '%s' "${line#*=}" | tr -d '\r' \
    | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}

command -v docker >/dev/null 2>&1 || fail "docker not found in PATH"
docker inspect "$CONTAINER" >/dev/null 2>&1 \
  || fail "container $CONTAINER not found — is the stack up?"

mkdir -p "$BACKUP_DIR"
ts=$(date +%Y%m%d-%H%M%S)
file="$BACKUP_DIR/daily-${ts}.sql.gz"

echo "[backup] dumping $CONTAINER → $file"
# POSIX sh 没有 pipefail，dump 后再做完整性检查兜底。
docker exec "$CONTAINER" pg_dump -U lucent -d lucent | gzip > "$file" \
  || { rm -f "$file"; fail "pg_dump | gzip failed"; }
if [ ! -s "$file" ] || ! gzip -t "$file" 2>/dev/null; then
  rm -f "$file"
  fail "dump file empty or corrupt: $file"
fi

# 本地保留最近 KEEP 份（文件名含时间戳，按名字倒序即按时间倒序）。
ls -1 "$BACKUP_DIR"/daily-*.sql.gz 2>/dev/null | sort -r \
  | tail -n "+$((KEEP + 1))" | while read -r old; do
  echo "[backup] pruning old backup: $old"
  rm -f "$old"
done

COS_BUCKET=$(env_value COS_BUCKET)
COS_REGION=$(env_value COS_REGION)
COS_SECRET_ID=$(env_value COS_SECRET_ID)
COS_SECRET_KEY=$(env_value COS_SECRET_KEY)

if [ -n "${COS_BUCKET}${COS_REGION}${COS_SECRET_ID}${COS_SECRET_KEY}" ]; then
  if [ -z "$COS_BUCKET" ] || [ -z "$COS_REGION" ] \
    || [ -z "$COS_SECRET_ID" ] || [ -z "$COS_SECRET_KEY" ]; then
    echo "[backup] WARNING: COS_* partially configured in .env — skipping offsite upload" >&2
  elif command -v coscli >/dev/null 2>&1; then
    echo "[backup] uploading to cos://$COS_BUCKET/backups/$(basename "$file") via coscli"
    coscli cp "$file" "cos://$COS_BUCKET/backups/$(basename "$file")" \
      || fail "coscli upload failed"
  elif command -v coscmd >/dev/null 2>&1; then
    echo "[backup] uploading to COS backups/$(basename "$file") via coscmd"
    coscmd -a "$COS_SECRET_ID" -s "$COS_SECRET_KEY" -b "$COS_BUCKET" -r "$COS_REGION" \
      upload "$file" "backups/$(basename "$file")" \
      || fail "coscmd upload failed"
  else
    echo "[backup] WARNING: COS_* configured but neither coscli nor coscmd found — skipping offsite upload" >&2
  fi
else
  echo "[backup] COS_* not configured — local backup only"
fi

echo "[backup] done: $file ($(du -h "$file" | cut -f1))"
