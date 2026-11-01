#!/usr/bin/env bash
# Installs taibu-updater.service on the host. The web container asks for an
# update by writing ${TAIBU_RUN_DIR}/update-request; this service then runs
# deploy/update.sh, which delegates to deploy/deploy.sh <tag>.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "This script must be run as root or with sudo" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${ROOT:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
RUN_DIR="${TAIBU_RUN_DIR:-/run/taibu}"
WEB_GID=101
ENV_FILE="${ENV_FILE:-/opt/taibu/env/compose.env}"
SERVICE_NAME="taibu-updater"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

for script in deploy.sh update.sh update-watch.sh; do
  if [[ ! -f "${SCRIPT_DIR}/${script}" ]]; then
    echo "Error: ${SCRIPT_DIR}/${script} not found" >&2
    exit 1
  fi
  chmod +x "${SCRIPT_DIR}/${script}"
done

# The web image runs as uid 100, gid 101. Only that group and root may access
# the signal directory; other host users cannot ask the root service to deploy.
install -d -o root -g "${WEB_GID}" -m 0730 "${RUN_DIR}"

cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=Taibu auto-updater
After=network-online.target docker.service
Requires=docker.service

[Service]
Type=simple
Environment=ROOT=${ROOT}
Environment=ENV_FILE=${ENV_FILE}
Environment=TAIBU_RUN_DIR=${RUN_DIR}
Environment=TAIBU_WEB_GID=${WEB_GID}
ExecStart=/usr/bin/env bash ${SCRIPT_DIR}/update-watch.sh
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}"

echo "✓ ${SERVICE_NAME} installed and started"
echo "  Project root: ${ROOT}"
echo "  Signal file:  ${RUN_DIR}/update-request"
echo "  Compose env:  ${ENV_FILE}"
echo "  Logs:         journalctl -u ${SERVICE_NAME} -f"
echo
echo "Add TAIBU_RUN_DIR=${RUN_DIR} to ${ENV_FILE} so the web service mounts the same directory."
