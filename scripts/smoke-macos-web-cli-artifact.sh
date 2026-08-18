#!/bin/sh
set -eu

REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
VERSION=$(node -p "require('$REPO_ROOT/package.json').version")
case "$(uname -m)" in
  arm64) ARCH="arm64" ;;
  x86_64) ARCH="x64" ;;
  *) echo "Unsupported macOS architecture: $(uname -m)" >&2; exit 1 ;;
esac
BUNDLE_NAME="paseo-web-cli-$VERSION-macos-$ARCH"
ARTIFACT="$REPO_ROOT/artifacts/$BUNDLE_NAME.tar.gz"
CHECKSUM="$ARTIFACT.sha256"
SMOKE_ROOT=$(mktemp -d /private/tmp/paseo-release-smoke.XXXXXX)
SMOKE_PID=""
PORT="${PASEO_RELEASE_SMOKE_PORT:-17677}"
CENTRAL_PORT="${PASEO_RELEASE_SMOKE_CENTRAL_PORT:-17679}"

stop_smoke() {
  if [ -n "$SMOKE_PID" ]; then
    kill "$SMOKE_PID" >/dev/null 2>&1 || true
    wait "$SMOKE_PID" >/dev/null 2>&1 || true
  fi
}
trap stop_smoke EXIT INT TERM

cd "$(dirname "$ARTIFACT")"
/usr/bin/shasum -a 256 -c "$(basename "$CHECKSUM")"
/usr/bin/tar -xzf "$ARTIFACT" -C "$SMOKE_ROOT"
BUNDLE="$SMOKE_ROOT/$BUNDLE_NAME"

/usr/bin/grep -Fq 'Refusing to replace Paseo while an agent is running or starting' "$BUNDLE/install.sh"
/usr/bin/grep -Fq 'failed authoritative startup readback' "$BUNDLE/install.sh"

mkdir -p "$SMOKE_ROOT/help-home"
HOME="$SMOKE_ROOT/help-home" "$BUNDLE/install.sh" --help >/dev/null
HELP_FILES=$(find "$SMOKE_ROOT/help-home" -mindepth 1 -print | wc -l | tr -d ' ')
test "$HELP_FILES" = "0"

mkdir -p "$SMOKE_ROOT/home"
HOME="$SMOKE_ROOT/home" "$BUNDLE/install.sh" \
  --prefix "$SMOKE_ROOT/install" \
  --bin-dir "$SMOKE_ROOT/bin" \
  --listen "127.0.0.1:$PORT" \
  --label com.paseo.web-cli.smoke \
  --no-start

HOME="$SMOKE_ROOT/home" "$SMOKE_ROOT/bin/paseo" --version
HOME="$SMOKE_ROOT/home" "$SMOKE_ROOT/bin/paseo-foundation" doctor --json >/dev/null
test -x "$SMOKE_ROOT/install/current/components/beads-central/beads-central"
test -x "$SMOKE_ROOT/install/current/components/beads-central/bin/bd"
"$SMOKE_ROOT/install/current/runtime/bin/node" -e '
const fs = require("fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (manifest.beadsBackend !== "central") process.exit(1);
if (manifest.beadsCentralClientIncluded !== true) process.exit(1);
if (manifest.beadsCentralRequiredVersion !== "1.2.0") process.exit(1);
if (manifest.beadsCentralSidecarIncluded !== true) process.exit(1);
if (manifest.bundledBeadsBinary !== true) process.exit(1);
if (manifest.internalPackages?.["@paseo/plugin"] !== manifest.version) process.exit(1);
' "$SMOKE_ROOT/install/current/manifest.json"

HOME="$SMOKE_ROOT/home" PASEO_HOME="$SMOKE_ROOT/home/.paseo" \
  PASEO_RELEASE_SMOKE=1 \
  PASEO_BEADS_CENTRAL_SMOKE_ENDPOINT="http://127.0.0.1:$CENTRAL_PORT" \
  "$SMOKE_ROOT/bin/paseo" daemon start --foreground \
  --listen "127.0.0.1:$PORT" --web-ui --no-relay >"$SMOKE_ROOT/daemon.log" 2>&1 &
SMOKE_PID=$!

HEALTHY=0
for _attempt in $(seq 1 30); do
  if /usr/bin/curl -fsS --max-time 1 "http://127.0.0.1:$PORT/api/health" \
    >"$SMOKE_ROOT/health.json"; then
    HEALTHY=1
    break
  fi
  sleep 1
done
test "$HEALTHY" = "1"

/usr/bin/curl -fsS --max-time 3 "http://127.0.0.1:$PORT/" >"$SMOKE_ROOT/index.html"
/usr/bin/grep -Fq '<title>Paseo</title>' "$SMOKE_ROOT/index.html"
/bin/cat "$SMOKE_ROOT/health.json"
/bin/echo

HOME="$SMOKE_ROOT/home" PASEO_HOME="$SMOKE_ROOT/home/.paseo" \
  "$SMOKE_ROOT/bin/paseo" daemon stop >/dev/null 2>&1 || true
wait "$SMOKE_PID" >/dev/null 2>&1 || true
SMOKE_PID=""

printf 'SMOKE_OK help_side_effects=%s cli=ok foundation=ok plugin=ok central_sidecar=ok native_bd=bundled daemon=ok webui=ok\n' "$HELP_FILES"
printf 'SMOKE_ROOT=%s\n' "$SMOKE_ROOT"
