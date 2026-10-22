#!/bin/sh
set -eu
# Hourly local dumps plus daily restic snapshots; the loop is intentionally
# simple so a failed restic push never blocks the next hourly dump.
while :; do
  /usr/local/bin/backup.sh hourly || echo "backup: hourly pass failed" >&2
  if [ "$(date +%H)" = "03" ] && [ "$(date +%M)" -lt 5 ]; then
    /usr/local/bin/backup.sh offsite || echo "backup: restic pass failed" >&2
    /usr/local/bin/backup.sh prune || true
  fi
  sleep 3600
done
