#!/bin/sh
# Run on the host, not in CI. Every step is explicit so a failed database setup
# stops the rollout before web/worker are replaced.
set -eu
TAG="${1:?usage: deploy.sh <tag>}"
ENV_FILE="${ENV_FILE:-/opt/taibu/env/compose.env}"
BACKUP_DIR="${BACKUP_DIR:-/opt/taibu/backups}"
KEEP_BACKUPS="${KEEP_BACKUPS:-10}"
# Rolling back replaces the application images only; database definitions were
# already reconciled by db:init, so restore the pre-flight dump to go back
# further than the previous release.
PREVIOUS_TAG=""
if [ -f "$ENV_FILE" ]; then
  PREVIOUS_TAG="$(sed -n 's/^TAIBU_TAG=//p' "$ENV_FILE" | tail -n 1)"
fi
export TAIBU_TAG="$TAG"
ROOT="${ROOT:-/opt/taibu/source}"
# host: an existing system Caddy proxies 127.0.0.1:3000 (hw).
# container: this compose stack owns the caddy service and 80/443.
# The updater service passes no EDGE_MODE, so compose.env keeps the host's choice.
if [ -z "${EDGE_MODE:-}" ] && [ -f "$ENV_FILE" ]; then
  EDGE_MODE="$(sed -n 's/^EDGE_MODE=//p' "$ENV_FILE" | tail -n 1)"
fi
EDGE_MODE="${EDGE_MODE:-container}"
case "$EDGE_MODE" in
  host|container) ;;
  *) echo "EDGE_MODE must be host or container (got $EDGE_MODE)" >&2; exit 2 ;;
esac

compose() {
  if [ "$EDGE_MODE" = "host" ]; then
    docker compose --project-directory "$ROOT" --env-file "$ENV_FILE" \
      -f "$ROOT/deploy/compose.base.yml" -f "$ROOT/deploy/compose.prod.yml" \
      -f "$ROOT/deploy/compose.host-edge.yml" "$@"
  else
    docker compose --project-directory "$ROOT" --env-file "$ENV_FILE" \
      -f "$ROOT/deploy/compose.base.yml" -f "$ROOT/deploy/compose.prod.yml" "$@"
  fi
}

mkdir -p "$BACKUP_DIR"
RUNNING_SERVICES="$(compose ps --status running --services)" || {
  echo "[deploy] cannot inspect running services; refusing to skip the backup" >&2
  exit 1
}
if printf '%s\n' "$RUNNING_SERVICES" | grep -qx db; then
  echo "[deploy] pre-flight backup"
  BACKUP_FILE="$(mktemp "$BACKUP_DIR/pre-${TAG}-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")"
  if ! compose exec -T db sh -c 'pg_dump -U postgres -Fc taibu' > "$BACKUP_FILE"; then
    rm -f "$BACKUP_FILE"
    exit 1
  fi
  echo "[deploy] backup saved: $BACKUP_FILE"
  # Keep the newest pre-flight dumps; older ones are the operator's to archive.
  ls -1t "$BACKUP_DIR"/pre-* 2>/dev/null | tail -n +"$((KEEP_BACKUPS + 1))" | while IFS= read -r old; do
    rm -f "$old"
  done
else
  echo "[deploy] no running db; skipping pre-flight backup (first deploy)"
fi

echo "[deploy] pull ${TAG}"
compose pull
compose build backup
compose up -d db redis

# The one-shot services run here, explicitly, so a failure stops the rollout
# before web and worker are replaced. The long-running services then start with
# --no-deps: without it compose re-runs every `depends_on: service_completed_
# successfully` one-shot again, which repeated the SQL initialization on each
# deploy.
echo "[deploy] one-shot setup"
compose run --rm -T files-init
compose run --rm -T db-setup
compose run --rm -T db-init

rollback() {
  if [ -z "$PREVIOUS_TAG" ] || [ "$PREVIOUS_TAG" = "$TAG" ]; then
    echo "[deploy] no previous image tag recorded in $ENV_FILE; staying on $TAG" >&2
    return 0
  fi
  echo "[deploy] rolling web and worker back to $PREVIOUS_TAG (database keeps this release's definitions)" >&2
  TAIBU_TAG="$PREVIOUS_TAG"
  export TAIBU_TAG
  compose up -d --no-deps web worker || echo "[deploy] rollback could not start $PREVIOUS_TAG" >&2
}

echo "[deploy] start services"
if [ "$EDGE_MODE" = "host" ]; then
  # Switching from container edge must release 80/443 before host Caddy owns them.
  compose --profile edge stop caddy >/dev/null 2>&1 || true
  if ! compose up -d --no-deps web worker backup; then rollback; exit 1; fi
else
  if ! compose --profile edge up -d --no-deps web worker caddy backup; then rollback; exit 1; fi
fi

record_tag() {
  # Remember the release that is actually running. Without this the next
  # deploy reads the same stale tag from compose.env and rolls back to it.
  temporary="$(mktemp "$ENV_FILE.XXXXXX")"
  if sed "s/^TAIBU_TAG=.*/TAIBU_TAG=$TAG/" "$ENV_FILE" > "$temporary" \
    && ! grep -q '^TAIBU_TAG=' "$temporary"; then
    printf 'TAIBU_TAG=%s\n' "$TAG" >> "$temporary"
  fi
  chmod --reference="$ENV_FILE" "$temporary" 2>/dev/null || chmod 600 "$temporary"
  mv "$temporary" "$ENV_FILE"
}

echo "[deploy] waiting for readiness"
for attempt in $(seq 1 30); do
  if compose exec -T web wget -qO- http://127.0.0.1:3000/api/health/ready >/dev/null 2>&1; then
    record_tag || echo "[deploy] could not record $TAG in $ENV_FILE" >&2
    echo "[deploy] ready"
    exit 0
  fi
  sleep 2
done
echo "[deploy] readiness check failed" >&2
rollback
exit 1
