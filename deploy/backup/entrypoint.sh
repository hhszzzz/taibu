#!/bin/sh
set -eu
# Hourly local dumps plus daily restic snapshots; the loop is intentionally
# simple so a failed restic push never blocks the next hourly dump.
last_offsite_day=''
# Sleep to the next hour boundary instead of a fixed 3600s so passes do not drift.
sleep_until_next_hour() {
  now="$(date +%s)"
  sleep $((3600 - now % 3600))
}
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
  sleep_until_next_hour
done
