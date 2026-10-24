#!/bin/sh
# Run on the host, not in CI. Every step is explicit so a failed database setup
# stops the rollout before web/worker are replaced.
set -eu
TAG="${1:?usage: deploy.sh <tag>}"
export TAIBU_TAG="$TAG"
ENV_FILE="${ENV_FILE:-/opt/taibu/env/compose.env}"
ROOT="${ROOT:-/opt/taibu/source}"
# host: an existing system Caddy proxies 127.0.0.1:3000 (hw).
# container: this compose stack owns the caddy service and 80/443.
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

mkdir -p /opt/taibu/backups
RUNNING_SERVICES="$(compose ps --status running --services)" || {
  echo "[deploy] cannot inspect running services; refusing to skip the backup" >&2
  exit 1
}
if printf '%s\n' "$RUNNING_SERVICES" | grep -qx db; then
  echo "[deploy] pre-flight backup"
  BACKUP_FILE="$(mktemp "/opt/taibu/backups/pre-${TAG}-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")"
  if ! compose exec -T db sh -c 'pg_dump -U postgres -Fc taibu' > "$BACKUP_FILE"; then
    rm -f "$BACKUP_FILE"
    exit 1
  fi
  echo "[deploy] backup saved: $BACKUP_FILE"
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

echo "[deploy] start services"
if [ "$EDGE_MODE" = "host" ]; then
  # Switching from container edge must release 80/443 before host Caddy owns them.
  compose --profile edge stop caddy >/dev/null 2>&1 || true
  compose up -d --no-deps web worker backup
else
  compose --profile edge up -d --no-deps web worker caddy backup
fi

echo "[deploy] waiting for readiness"
for attempt in $(seq 1 30); do
  if compose exec -T web wget -qO- http://127.0.0.1:3000/api/health/ready >/dev/null 2>&1; then
    echo "[deploy] ready"
    exit 0
  fi
  sleep 2
done
echo "[deploy] readiness check failed" >&2
exit 1
