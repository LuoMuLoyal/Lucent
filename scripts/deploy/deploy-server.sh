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

compose() {
  docker compose "$@"
}

wait_for_service() {
  service_name="$1"
  max_attempts="${HEALTHCHECK_MAX_ATTEMPTS:-30}"
  sleep_seconds="${HEALTHCHECK_SLEEP_SECONDS:-5}"
  attempt=1

  while [ "$attempt" -le "$max_attempts" ]; do
    container_id="$(compose ps -q "$service_name")"

    if [ -n "$container_id" ]; then
      service_status="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"

      case "$service_status" in
        healthy)
          echo "$service_name is healthy."
          return 0
          ;;
        running)
          echo "$service_name is running."
          return 0
          ;;
        unhealthy|dead|exited)
          echo "$service_name entered status: $service_status" >&2
          compose logs --tail=200 "$service_name" || true
          return 1
          ;;
      esac
    fi

    echo "Waiting for $service_name ($attempt/$max_attempts)..."
    sleep "$sleep_seconds"
    attempt=$((attempt + 1))
  done

  echo "Timed out waiting for $service_name." >&2
  compose logs --tail=200 "$service_name" || true
  return 1
}

require_env LUCENT_RUNTIME_DIR

if [ ! -f "$LUCENT_RUNTIME_DIR/.env.production" ]; then
  echo "$LUCENT_RUNTIME_DIR/.env.production is missing." >&2
  exit 1
fi

require_env_file_key() {
  variable_name="$1"

  if ! grep -Eq "^${variable_name}=.+" "$LUCENT_RUNTIME_DIR/.env.production"; then
    echo "Missing required key in $LUCENT_RUNTIME_DIR/.env.production: $variable_name" >&2
    exit 1
  fi
}

warn_if_env_file_key_missing() {
  variable_name="$1"

  if ! grep -Eq "^${variable_name}=.+" "$LUCENT_RUNTIME_DIR/.env.production"; then
    echo "Warning: $variable_name is not set in $LUCENT_RUNTIME_DIR/.env.production; related synthetic checks will stay unconfigured." >&2
  fi
}

require_env_file_key GF_SECURITY_ADMIN_PASSWORD
warn_if_env_file_key_missing SYNTHETIC_LOGIN_EMAIL
warn_if_env_file_key_missing SYNTHETIC_LOGIN_PASSWORD

mkdir -p "$LUCENT_RUNTIME_DIR"
export LUCENT_RUNTIME_DIR
compose pull postgres redis prometheus grafana nginx
compose build app
compose up -d postgres redis
wait_for_service postgres
wait_for_service redis
compose up -d --no-deps app

if ! wait_for_service app; then
  exit 1
fi

compose up -d synthetic-monitor prometheus grafana nginx
wait_for_service synthetic-monitor
wait_for_service prometheus
wait_for_service grafana
wait_for_service nginx

compose ps
