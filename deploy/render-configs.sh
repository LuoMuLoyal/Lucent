#!/bin/sh
# Lucent 监控配置渲染脚本（在服务器 /opt/lucent 下运行）
#
# prometheus/prometheus.yml 与 alertmanager/alertmanager.yml 是【模板】，
# 含 ${VAR} 占位符；prometheus/alertmanager 均不支持配置内环境变量插值。
# 渲染统一在宿主机执行（此前容器内 sh -c 渲染因 compose 内联脚本的
# 转义差异导致 sed 失败，故改为宿主机渲染，见 deployment.md）。
#
# 用法：
#   cd /opt/lucent && ./render-configs.sh
#
# deploy.ts 每次发布会在 pre-flight 自动调用本脚本（失败仅警告不阻塞发布）。
# 手动修改 .env 的 METRICS_* / WECOM_* 后需重跑本脚本并重启对应容器：
#   docker compose up -d prometheus
#   docker compose --profile alerting up -d alertmanager
#
# 渲染产物（含密钥，已被 .gitignore 排除，不离开服务器）：
#   prometheus/.rendered/prometheus.yml
#   alertmanager/.rendered/alertmanager.yml （仅当 WECOM_* 全部配置时生成）

set -eu

DEPLOY_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$DEPLOY_DIR"

if [ ! -f .env ]; then
  echo "[render] ERROR: .env not found in $DEPLOY_DIR" >&2
  exit 1
fi

# 读取 .env 中指定 key 的值（取最后一处定义，去掉首尾成对引号）
get_env() {
  value=$(sed -n "s/^$1=//p" .env | tail -n 1)
  case "$value" in
    \"*\" | \'*\')
      value=${value#?}
      value=${value%?}
      ;;
  esac
  printf '%s' "$value"
}

# sed 替换值转义：& | \ 在 replacement 中是特殊字符（| 是分隔符）
esc() {
  printf '%s' "$1" | sed -e 's/[&|\\]/\\&/g'
}

# render <模板> <产物> <VAR1> [VAR2 ...]
render() {
  template=$1
  output=$2
  shift 2
  mkdir -p "$(dirname "$output")"
  cp "$template" "$output.tmp"
  for var in "$@"; do
    val=$(get_env "$var")
    sed -i -e "s|\${$var}|$(esc "$val")|g" "$output.tmp"
  done
  mv "$output.tmp" "$output"
  chmod 600 "$output"
  echo "[render] rendered $output"
}

# ── prometheus（必需 METRICS_USER / METRICS_PASSWORD） ──────────────
missing=0
for v in METRICS_USER METRICS_PASSWORD; do
  if [ -z "$(get_env "$v")" ]; then
    echo "[render] ERROR: $v is empty in .env" >&2
    missing=1
  fi
done
[ "$missing" -eq 0 ] || exit 1

render prometheus/prometheus.yml prometheus/.rendered/prometheus.yml \
  METRICS_USER METRICS_PASSWORD

# ── alertmanager（可选：WECOM_* 全部配置才渲染） ────────────────────
wecom_missing=0
for v in WECOM_CORP_ID WECOM_CORP_SECRET WECOM_AGENT_ID WECOM_TO_USER; do
  if [ -z "$(get_env "$v")" ]; then
    wecom_missing=1
    break
  fi
done

if [ "$wecom_missing" -eq 1 ]; then
  echo "[render] WECOM_* not fully configured — skipping alertmanager.yml (alerting profile stays disabled)"
else
  render alertmanager/alertmanager.yml alertmanager/.rendered/alertmanager.yml \
    WECOM_CORP_ID WECOM_CORP_SECRET WECOM_AGENT_ID WECOM_TO_USER
fi

echo "[render] done"
