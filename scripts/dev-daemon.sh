#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$ROOT_DIR/node_modules/.bin:$PATH"

source "$SCRIPT_DIR/dev-home.sh"

export PASEO_LISTEN="${PASEO_LISTEN:-127.0.0.1:6768}"
configure_dev_paseo_home

BEADS_COMPONENT_DIR="$ROOT_DIR/artifacts/dev-components/beads-central"
node "$ROOT_DIR/scripts/build-beads-central-sidecar.mjs" --output "$BEADS_COMPONENT_DIR"
export PASEO_BEADS_CENTRAL_SIDECAR="$BEADS_COMPONENT_DIR/beads-central"
export PASEO_BEADS_CENTRAL_BD_BIN="$BEADS_COMPONENT_DIR/bin/bd"

if [ -z "${PASEO_LOCAL_MODELS_DIR}" ]; then
  export PASEO_LOCAL_MODELS_DIR="$HOME/.paseo/models/local-speech"
  mkdir -p "$PASEO_LOCAL_MODELS_DIR"
fi

echo "══════════════════════════════════════════════════════"
echo "  Paseo Dev Daemon"
echo "══════════════════════════════════════════════════════"
echo "  Home:    ${PASEO_HOME}"
echo "  Models:  ${PASEO_LOCAL_MODELS_DIR}"
echo "  Listen:  ${PASEO_LISTEN}"
echo "══════════════════════════════════════════════════════"

export PASEO_CORS_ORIGINS="${PASEO_CORS_ORIGINS:-*}"
export PASEO_NODE_INSPECT="${PASEO_NODE_INSPECT:---inspect=0}"

if [ "${PASEO_SKIP_DEV_SERVER_BUILD:-0}" = "1" ]; then
  exec npm run dev:server:watch
fi

exec sh -c 'npm run build:server-deps && npm run dev:server:watch'
