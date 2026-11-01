#!/usr/bin/env bash
# Watches the shared run directory for an update request written by the web app
# and runs deploy/update.sh once per request. Polling keeps the unit free of
# inotify-tools and survives the run directory being recreated.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="${TAIBU_RUN_DIR:-/run/taibu}"
WEB_GID="${TAIBU_WEB_GID:-101}"
SIGNAL="${RUN_DIR}/update-request"

install -d -o root -g "${WEB_GID}" -m 0730 "${RUN_DIR}"
# The web app only accepts update requests when this marker exists.
install -o root -g "${WEB_GID}" -m 0640 /dev/null "${RUN_DIR}/updater-ready"

while true; do
  if [[ -f "${SIGNAL}" ]]; then
    "${SCRIPT_DIR}/update.sh" || echo "update.sh exited non-zero; waiting for the next request" >&2
  fi
  sleep 5
done
