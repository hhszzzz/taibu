#!/bin/sh
# Run on the host, not in CI. Every step is explicit so a failed migration
# stops the rollout before web/worker are replaced.
set -eu
TAG="${1:?usage: deploy.sh <tag>}"
export TAIBU_TAG="$TAG"
ENV_FILE="${ENV_FILE:-/opt/taibu/env/compose.env}"
ROOT="${ROOT:-/opt/taibu/source}"

compose() {
  docker compose --project-directory "$ROOT" --env-file "$ENV_FILE" \
    -f "$ROOT/deploy/compose.base.yml" -f "$ROOT/deploy/compose.prod.yml" "$@"
}

echo "[deploy] pre-flight backup"
mkdir -p /opt/taibu/backups
compose exec -T db sh -c 'pg_dump -U postgres -Fc taibu' > "/opt/taibu/backups/pre-${TAG}.dump"

echo "[deploy] pull ${TAG}"
compose pull
compose build backup
compose up -d db redis
compose run --rm -T db-setup
compose run --rm -T migrate
compose up -d web worker caddy backup

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
