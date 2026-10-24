#!/bin/sh
# Refreshes the Cloudflare proxy ranges in a Caddyfile from Cloudflare's
# published lists (https://www.cloudflare.com/ips-v4 and /ips-v6).
#
#   deploy/update-cloudflare-ips.sh [Caddyfile]
#
# The file is rewritten atomically and only when the ranges changed. Reloading
# is left to the operator so a stale-but-working config is never reloaded
# blindly; when the script reports a change:
#   docker compose ... exec caddy caddy validate --config /etc/caddy/Caddyfile
#   docker compose ... exec caddy caddy reload --config /etc/caddy/Caddyfile
set -eu

file="${1:-$(dirname "$0")/Caddyfile}"
[ -f "$file" ] || { echo "no such Caddyfile: $file" >&2; exit 2; }

fetch() {
  if command -v curl >/dev/null 2>&1; then curl -fsS --max-time 20 "$1"; else wget -qO- --timeout=20 "$1"; fi
}

ranges="$( { fetch https://www.cloudflare.com/ips-v4; echo; fetch https://www.cloudflare.com/ips-v6; } | awk 'NF' )"

if [ -z "$ranges" ]; then
  echo "Cloudflare returned no ranges; keeping $file unchanged" >&2
  exit 1
fi
if printf '%s\n' "$ranges" | grep -Evq '^[0-9a-fA-F:.]+/[0-9]{1,3}$'; then
  echo "Cloudflare returned a line that is not a CIDR:" >&2
  printf '%s\n' "$ranges" | grep -Ev '^[0-9a-fA-F:.]+/[0-9]{1,3}$' | head -n 3 >&2
  exit 1
fi
if [ "$(printf '%s\n' "$ranges" | grep -c '\.')" -lt 5 ]; then
  echo "Cloudflare returned fewer than five IPv4 ranges; refusing to shrink the allow-list" >&2
  exit 1
fi

line="		trusted_proxies static $(printf '%s\n' "$ranges" | tr '\n' ' ' | sed 's/ $//')"
if ! grep -q 'trusted_proxies static ' "$file"; then
  echo "$file has no 'trusted_proxies static' line to refresh" >&2
  exit 1
fi

directory="$(dirname "$file")"
temporary="$(mktemp "$directory/.cloudflare-ips-XXXXXX")"
trap 'rm -f "$temporary"' EXIT
awk -v line="$line" '/^[[:space:]]*trusted_proxies static /{ print line; next } { print }' "$file" > "$temporary"

if cmp -s "$file" "$temporary"; then
  echo "[cloudflare-ips] $file already has the current ranges"
  exit 0
fi

cat "$temporary" > "$file"
echo "[cloudflare-ips] updated $file"
echo "[cloudflare-ips] validate and reload Caddy when convenient"
