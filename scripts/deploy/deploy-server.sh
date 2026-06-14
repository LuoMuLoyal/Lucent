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
  docker compose --env-file "$LUCENT_RUNTIME_DIR/.deploy-image.env" "$@"
}

write_image_env() {
  app_image_ref="$1"
  postgres_image_ref="$2"
  redis_image_ref="$3"
  prometheus_image_ref="$4"
  grafana_image_ref="$5"
  nginx_image_ref="$6"

  cat > "$LUCENT_RUNTIME_DIR/.deploy-image.env" <<EOF
LUCENT_IMAGE=$app_image_ref
POSTGRES_IMAGE=$postgres_image_ref
REDIS_IMAGE=$redis_image_ref
PROMETHEUS_IMAGE=$prometheus_image_ref
GRAFANA_IMAGE=$grafana_image_ref
NGINX_IMAGE=$nginx_image_ref
EOF
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

require_env LUCENT_IMAGE
require_env POSTGRES_IMAGE
require_env REDIS_IMAGE
require_env PROMETHEUS_IMAGE
require_env GRAFANA_IMAGE
require_env NGINX_IMAGE
require_env LUCENT_RUNTIME_DIR
require_env REGISTRY_HOST
require_env REGISTRY_USERNAME
require_env REGISTRY_PASSWORD

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
write_image_env "$LUCENT_IMAGE" "$POSTGRES_IMAGE" "$REDIS_IMAGE" "$PROMETHEUS_IMAGE" "$GRAFANA_IMAGE" "$NGINX_IMAGE"

export LUCENT_RUNTIME_DIR

printf '%s\n' "$REGISTRY_PASSWORD" | docker login "$REGISTRY_HOST" -u "$REGISTRY_USERNAME" --password-stdin

compose pull postgres redis app
compose up -d postgres redis
wait_for_service postgres
wait_for_service redis
compose up -d --no-deps app

if ! wait_for_service app; then
  exit 1
fi

compose pull synthetic-monitor prometheus grafana nginx
compose up -d synthetic-monitor prometheus grafana nginx
wait_for_service synthetic-monitor
wait_for_service prometheus
wait_for_service grafana
wait_for_service nginx

compose ps
