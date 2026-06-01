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
  docker compose --env-file .deploy-image.env "$@"
}

write_image_env() {
  app_image_ref="$1"
  postgres_image_ref="$2"
  redis_image_ref="$3"

  cat > .deploy-image.env <<EOF
LUCENT_IMAGE=$app_image_ref
POSTGRES_IMAGE=$postgres_image_ref
REDIS_IMAGE=$redis_image_ref
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

rollback_app() {
  if [ -z "${PREVIOUS_LUCENT_IMAGE:-}" ] || [ "$PREVIOUS_LUCENT_IMAGE" = "$LUCENT_IMAGE" ]; then
    echo "No previous app image available for rollback." >&2
    return 1
  fi

  echo "Rolling back app to $PREVIOUS_LUCENT_IMAGE..."
  write_image_env "$PREVIOUS_LUCENT_IMAGE" "$POSTGRES_IMAGE" "$REDIS_IMAGE"
  compose up -d --no-deps app
  wait_for_service app
}

require_env LUCENT_IMAGE
require_env POSTGRES_IMAGE
require_env REDIS_IMAGE
require_env REGISTRY_HOST
require_env REGISTRY_USERNAME
require_env REGISTRY_PASSWORD

if [ ! -f .env.production ]; then
  echo ".env.production is missing in $(pwd)." >&2
  exit 1
fi

PREVIOUS_LUCENT_IMAGE=''
if [ -f .deploy-image.env ]; then
  PREVIOUS_LUCENT_IMAGE="$(sed -n 's/^LUCENT_IMAGE=//p' .deploy-image.env | tail -n 1)"
fi

write_image_env "$LUCENT_IMAGE" "$POSTGRES_IMAGE" "$REDIS_IMAGE"

printf '%s\n' "$REGISTRY_PASSWORD" | docker login "$REGISTRY_HOST" -u "$REGISTRY_USERNAME" --password-stdin

compose pull postgres redis app
compose up -d postgres redis
wait_for_service postgres
wait_for_service redis
compose up -d --no-deps app

if ! wait_for_service app; then
  rollback_app || true
  exit 1
fi

compose ps
