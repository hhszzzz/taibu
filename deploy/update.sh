#!/usr/bin/env bash
# Runs one update requested from the admin UI: hand the release tag to
# deploy/deploy.sh (backup, pull, db-setup/db-init, rolling restart) and record
# the outcome in deployment_logs. Invoked by taibu-updater.service.
set -uo pipefail

ROOT="${ROOT:-/opt/taibu/source}"
ENV_FILE="${ENV_FILE:-/opt/taibu/env/compose.env}"
RUN_DIR="${TAIBU_RUN_DIR:-/run/taibu}"
SIGNAL="${RUN_DIR}/update-request"
HANDLED="${RUN_DIR}/update-request.handled"
LOG_FILE="$(mktemp /tmp/taibu-update-XXXXXX.log)"
COMPOSE_FILES=(-f "${ROOT}/deploy/compose.base.yml" -f "${ROOT}/deploy/compose.prod.yml")

log() { printf '%s %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*" | tee -a "${LOG_FILE}"; }

field() {
  grep -o "\"$1\":\"[^\"]*\"" "${HANDLED}" | head -n 1 | cut -d'"' -f4
}

# The same psql the deploy runs; variables are quoted by psql itself, so log
# text with quotes or newlines is safe.
record() {
  local status="$1" text="$2"
  docker compose --project-directory "${ROOT}" --env-file "${ENV_FILE}" "${COMPOSE_FILES[@]}" \
    exec -T db psql -U postgres -d taibu -v ON_ERROR_STOP=1 \
    -v id="${LOG_ID}" -v status="${status}" -v logtext="${text}" \
    -c "update public.deployment_logs set status = :'status', log_output = :'logtext', completed_at = now() where id = :'id'" \
    >>"${LOG_FILE}" 2>&1 || log "could not record ${status} for ${LOG_ID}"
}

[[ -f "${SIGNAL}" ]] || { echo "no signal file at ${SIGNAL}" >&2; exit 1; }
mv "${SIGNAL}" "${HANDLED}"
LOG_ID="$(field log_id)"
# Images are published under the release tag itself (v0.2.4).
TAG="$(field release_tag)"
TAG="${TAG:-}"
[[ -n "${LOG_ID}" && -n "${TAG}" ]] || {
  log "signal file is missing log_id or the release tag"
  rm -f "${HANDLED}"
  exit 1
}

log "updating to ${TAG} (log ${LOG_ID})"
record running "deploy/deploy.sh ${TAG}"

if ROOT="${ROOT}" ENV_FILE="${ENV_FILE}" "${ROOT}/deploy/deploy.sh" "${TAG}" >>"${LOG_FILE}" 2>&1; then
  log "update to ${TAG} finished"
  record success "$(tail -c 8000 "${LOG_FILE}")"
  rm -f "${HANDLED}"
else
  log "update to ${TAG} failed"
  record failed "$(tail -c 8000 "${LOG_FILE}")"
  # Keep the handled file for inspection; the next request overwrites it.
  exit 1
fi
