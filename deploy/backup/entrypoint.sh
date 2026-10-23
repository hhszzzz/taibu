#!/bin/sh
set -eu
# Hourly local dumps plus daily restic snapshots; the loop is intentionally
# simple so a failed restic push never blocks the next hourly dump.
last_offsite_day=''
while :; do
  /usr/local/bin/backup.sh hourly || echo "backup: hourly pass failed" >&2
  today="$(date +%F)"
  if [ "$(date +%H)" -ge 3 ] && [ "$last_offsite_day" != "$today" ]; then
    if /usr/local/bin/backup.sh offsite; then
      last_offsite_day="$today"
    else
      echo "backup: restic pass failed" >&2
    fi
    /usr/local/bin/backup.sh prune || true
  fi
  sleep 3600
done
