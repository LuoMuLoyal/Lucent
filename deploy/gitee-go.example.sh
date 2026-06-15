#!/bin/sh
set -eu

cd /opt/lucent/app
git pull --ff-only
export LUCENT_RUNTIME_DIR=/opt/lucent/runtime
sh scripts/deploy/deploy-server.sh
