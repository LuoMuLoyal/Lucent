#!/bin/sh
# =============================================================================
# check-cert.sh — TLS 证书过期检查 + node_exporter textfile 指标
#
# 功能：
#   1. 用 openssl 解析 ./certs/fullchain.pem 的 notAfter，计算剩余天数；
#   2. 原子写入 textfile 指标 ./data/node-exporter-textfile/lucent_cert.prom
#      （lucent_cert_expiry_days，供 Prometheus 的 LucentCertExpiry* 告警使用）；
#   3. 剩余 < 14 天时向 stderr 打警告（cron 邮件 / 人工可见）。
#
# 运行环境：/opt/lucent 下运行（全部使用相对路径）；需要 openssl 与 GNU date。
# 幂等：重复执行只覆盖同一个 .prom 文件（先写临时文件再 mv 原子替换，
#       node-exporter 要求 textfile 必须原子更新）。
#
# cron 示例（每小时第 17 分钟）：
#   17 * * * * cd /opt/lucent && ./check-cert.sh
# =============================================================================
set -eu

CERT_FILE="./certs/fullchain.pem"
TEXTFILE_DIR="./data/node-exporter-textfile"
OUT_FILE="$TEXTFILE_DIR/lucent_cert.prom"
WARN_DAYS=14

fail() {
  echo "[check-cert] ERROR: $1" >&2
  exit 1
}

command -v openssl >/dev/null 2>&1 || fail "openssl not found in PATH"
[ -f "$CERT_FILE" ] || fail "certificate file not found: $CERT_FILE"

end_date=$(openssl x509 -in "$CERT_FILE" -noout -enddate 2>/dev/null) \
  || fail "openssl failed to parse $CERT_FILE"
end_date=${end_date#notAfter=}
[ -n "$end_date" ] || fail "empty notAfter in $CERT_FILE"

expiry_epoch=$(date -d "$end_date" +%s 2>/dev/null) \
  || fail "date failed to parse '$end_date' (GNU date required)"
now_epoch=$(date +%s)
days=$(( (expiry_epoch - now_epoch) / 86400 ))

mkdir -p "$TEXTFILE_DIR"
tmp_file="$OUT_FILE.tmp.$$"
cat > "$tmp_file" <<EOF
# HELP lucent_cert_expiry_days Days until the TLS certificate in certs/fullchain.pem expires.
# TYPE lucent_cert_expiry_days gauge
lucent_cert_expiry_days $days
EOF
chmod 644 "$tmp_file"
mv "$tmp_file" "$OUT_FILE"

echo "[check-cert] $CERT_FILE expires in $days day(s); metric written to $OUT_FILE"
if [ "$days" -lt "$WARN_DAYS" ]; then
  echo "[check-cert] WARNING: TLS certificate expires in $days day(s) (< $WARN_DAYS) — renew it soon" >&2
fi
