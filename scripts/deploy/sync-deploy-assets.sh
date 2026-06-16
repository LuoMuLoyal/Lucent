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

require_env LUCENT_RELEASES_DIR
require_env LUCENT_RELEASE_ID

release_dir="$LUCENT_RELEASES_DIR/$LUCENT_RELEASE_ID"
current_link="$LUCENT_RELEASES_DIR/current"

if [ ! -d "$release_dir" ]; then
  echo "Release directory not found: $release_dir" >&2
  exit 1
fi

mkdir -p "$LUCENT_RELEASES_DIR"

rm -rf "$current_link"
ln -s "$release_dir" "$current_link"

echo "Synced deploy assets to $current_link"
