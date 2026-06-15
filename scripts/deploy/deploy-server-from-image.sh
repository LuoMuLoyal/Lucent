#!/bin/sh
set -eu

require_env() {
  variable_name="$1"
  eval "variable_value=\${$variable_name:-}"

  if [ -z "$variable_value" ]; then
    echo "Missing required environment variable: $variable_name" >&2
    exit 1
  fi
}

require_env SERVER_APP_DIR
require_env LUCENT_RUNTIME_DIR
require_env LUCENT_IMAGE
require_env POSTGRES_IMAGE
require_env REDIS_IMAGE
require_env PROMETHEUS_IMAGE
require_env GRAFANA_IMAGE
require_env NGINX_IMAGE

cd "$SERVER_APP_DIR"
git pull --ff-only
export LUCENT_RUNTIME_DIR
sh scripts/deploy/deploy-server.sh
