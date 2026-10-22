#!/bin/sh
set -eu
MODE="${1:-hourly}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOCAL_KEEP_HOURS="${LOCAL_KEEP_HOURS:-48}"

dump() {
  PGPASSWORD="$TAIBU_BACKUP_PASSWORD" pg_dump \
    -h db -U taibu_backup -d taibu -Fc -f "/backups/taibu-${STAMP}.dump"
}

case "$MODE" in
  hourly)
    dump
    # Keep 48 hourly dumps; failures are surfaced by the entrypoint loop.
    find /backups -name 'taibu-*.dump' -type f -mmin +"$((LOCAL_KEEP_HOURS * 60))" -delete
    ;;
  offsite)
    : "${RESTIC_REPOSITORY:?}"
    : "${RESTIC_PASSWORD:?}"
    restic backup --tag taibu-db /backups --tag taibu-files /data/files
    ;;
  prune)
    restic forget --keep-hourly 24 --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
    ;;
  *)
    echo "usage: backup.sh hourly|offsite|prune" >&2
    exit 2
    ;;
esac
