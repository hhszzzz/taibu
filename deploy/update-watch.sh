#!/usr/bin/env bash
# Watches the shared run directory for an update request written by the web app
# and runs deploy/update.sh once per request. Polling keeps the unit free of
# inotify-tools and survives the run directory being recreated.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="${TAIBU_RUN_DIR:-/run/taibu}"
SIGNAL="${RUN_DIR}/update-request"

mkdir -p "${RUN_DIR}"
chmod 1777 "${RUN_DIR}" 2>/dev/null || true
# The web app only accepts update requests when this marker exists.
touch "${RUN_DIR}/updater-ready"

while true; do
  if [[ -f "${SIGNAL}" ]]; then
    "${SCRIPT_DIR}/update.sh" || echo "update.sh exited non-zero; waiting for the next request" >&2
  fi
  sleep 5
done
