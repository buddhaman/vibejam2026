#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DEPLOY_HOST="${DEPLOY_HOST:-root@reduta}"
DEPLOY_DOMAIN="${DEPLOY_DOMAIN:-https://trussner.com}"
PUBLIC_BASE="${PUBLIC_BASE:-/agi/}"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-/opt/vibejam}"
REMOTE_STATIC_DIR="${REMOTE_STATIC_DIR:-/var/www/trussner.com/agi}"
REMOTE_SERVICE_NAME="${REMOTE_SERVICE_NAME:-vibejam.service}"

echo "==> Building production release for ${PUBLIC_BASE}"
(
  cd "${ROOT_DIR}"
  VITE_PUBLIC_BASE="${PUBLIC_BASE}" npm run build
)

echo "==> Syncing static client bundle to ${DEPLOY_HOST}:${REMOTE_STATIC_DIR}"
ssh "${DEPLOY_HOST}" "mkdir -p '${REMOTE_STATIC_DIR}'"
rsync -az --delete "${ROOT_DIR}/client/dist/" "${DEPLOY_HOST}:${REMOTE_STATIC_DIR}/"

echo "==> Syncing server bundle to ${DEPLOY_HOST}:${REMOTE_APP_DIR}"
ssh "${DEPLOY_HOST}" "mkdir -p '${REMOTE_APP_DIR}/dist'"
rsync -az --delete \
  "${ROOT_DIR}/dist/" \
  "${DEPLOY_HOST}:${REMOTE_APP_DIR}/dist/"
rsync -az \
  "${ROOT_DIR}/package.json" \
  "${ROOT_DIR}/package-lock.json" \
  "${DEPLOY_HOST}:${REMOTE_APP_DIR}/"

echo "==> Installing production dependencies and restarting ${REMOTE_SERVICE_NAME}"
cat <<EOF | ssh "${DEPLOY_HOST}" bash -s
set -euo pipefail
cd "${REMOTE_APP_DIR}"
npm ci --omit=dev
cat > "${REMOTE_APP_DIR}/dist/package.json" <<'JSON'
{"type":"commonjs"}
JSON
systemctl restart "${REMOTE_SERVICE_NAME}"
sleep 1
systemctl --no-pager --full status "${REMOTE_SERVICE_NAME}" | sed -n '1,20p'
EOF

echo "==> Health checks"
curl --fail --silent --show-error "${DEPLOY_DOMAIN%/}${PUBLIC_BASE}" >/dev/null
curl --fail --silent --show-error "${DEPLOY_DOMAIN%/}${PUBLIC_BASE}colyseus/" >/dev/null
INDEX_HEADERS="$(curl -I --silent --show-error "${DEPLOY_DOMAIN%/}${PUBLIC_BASE}")"
ASSET_PATH="$(cd "${ROOT_DIR}/client/dist/assets" && ls index-*.js | head -n 1)"
ASSET_HEADERS="$(curl -I --silent --show-error "${DEPLOY_DOMAIN%/}${PUBLIC_BASE}assets/${ASSET_PATH}")"

echo "${INDEX_HEADERS}" | grep -Eiq 'cache-control:.*(no-store|max-age=0)' || {
  echo "ERROR: ${PUBLIC_BASE} is missing a no-cache Cache-Control header" >&2
  exit 1
}

echo "${ASSET_HEADERS}" | grep -Eiq 'cache-control:.*immutable' || {
  echo "ERROR: ${PUBLIC_BASE}assets/${ASSET_PATH} is missing an immutable Cache-Control header" >&2
  exit 1
}

echo "Release published successfully to ${DEPLOY_DOMAIN%/}${PUBLIC_BASE}"
