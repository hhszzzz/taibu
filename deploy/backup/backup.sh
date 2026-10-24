#!/bin/sh
set -eu
MODE="${1:-hourly}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOCAL_KEEP_HOURS="${LOCAL_KEEP_HOURS:-48}"
LOCAL_KEEP_DAYS="${LOCAL_KEEP_DAYS:-7}"

dump() {
  pending_dump="$(mktemp /backups/.taibu-dump-XXXXXX)"
  if PGPASSWORD="$TAIBU_BACKUP_PASSWORD" pg_dump \
    -h db -U taibu_backup -d taibu -Fc -f "$pending_dump"; then
    mv "$pending_dump" "/backups/taibu-${STAMP}.dump"
  else
    rm -f "$pending_dump"
    return 1
  fi
}

case "$MODE" in
  hourly)
    dump
    # Every successful hourly becomes the daily copy, so the daily file is
    # always the newest dump of the day. Picking only the first dump would
    # freeze the pre-import (empty) database on cutover day, when the first
    # hourly run happens before the import and no later run could replace it.
    cp "/backups/taibu-${STAMP}.dump" "/backups/taibu-daily-$(date -u +%Y%m%d).dump"
    # Keep 48 hourly dumps (daily copies excluded) and 7 daily dumps.
    find /backups -name 'taibu-*.dump' ! -name 'taibu-daily-*' -type f \
      -mmin +"$((LOCAL_KEEP_HOURS * 60))" -delete
    find /backups -name 'taibu-daily-*.dump' -type f \
      -mmin +"$((LOCAL_KEEP_DAYS * 24 * 60))" -delete
    ;;
  offsite)
    : "${RESTIC_REPOSITORY:?}"
    : "${RESTIC_PASSWORD:?}"
    # The repository is created once, on the first run against a new target.
    restic cat config >/dev/null 2>&1 || restic init
    restic backup --tag taibu-db /backups
    restic backup --tag taibu-files /data/files
    ;;
  prune)
    restic forget --keep-hourly 24 --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
    ;;
  *)
    echo "usage: backup.sh hourly|offsite|prune" >&2
    exit 2
    ;;
esac
