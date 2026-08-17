#!/bin/sh
set -eu

REPOSITORY="webplode/paseo-doctrine-downstream"
API_ROOT="${PASEO_DOWNSTREAM_API_ROOT:-https://api.github.com/repos/$REPOSITORY}"
DOWNLOAD_ROOT="${PASEO_DOWNSTREAM_DOWNLOAD_ROOT:-https://github.com/$REPOSITORY/releases/download}"
TAG="${PASEO_DOWNSTREAM_TAG:-}"

usage() {
  cat <<'USAGE'
Usage: install.sh [artifact installer options]

Download, verify, and install the newest Paseo Foundation Downstream release
for macOS or Linux.

Examples:
  ./install.sh
  ./install.sh --no-start
  PASEO_DOWNSTREAM_TAG=paseo-vX.Y.Z ./install.sh

All options are forwarded to the verified artifact's install.sh.
USAGE
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
esac

case "$(uname -s)" in
  Darwin) PLATFORM_NAME="macos"; MANIFEST_PLATFORM="darwin"; SHA_COMMAND="shasum" ;;
  Linux) PLATFORM_NAME="linux"; MANIFEST_PLATFORM="linux"; SHA_COMMAND="sha256sum" ;;
  *) echo "This installer supports macOS and Linux only." >&2; exit 1 ;;
esac
case "$(uname -m)" in
  arm64|aarch64) ARCH="arm64" ;;
  x86_64|amd64) ARCH="x64" ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac
if [ "$PLATFORM_NAME" = "linux" ] && [ "$ARCH" != "x64" ]; then
  echo "The Linux downstream release currently supports x64 only." >&2
  exit 1
fi

for command in awk curl grep tar mktemp "$SHA_COMMAND"; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command is missing: $command" >&2
    exit 1
  fi
done

TEMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/paseo-downstream-install.XXXXXX")
trap 'rm -rf "$TEMP_ROOT"' EXIT INT TERM

if [ -z "$TAG" ]; then
  RELEASES_JSON="$TEMP_ROOT/releases.json"
  curl --fail --silent --show-error --location --retry 3 \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "$API_ROOT/releases?per_page=1" > "$RELEASES_JSON"
  TAG=$(awk -F '"' '/"tag_name"[[:space:]]*:/ { print $4; exit }' "$RELEASES_JSON")
  if [ -z "$TAG" ]; then
    echo "No published downstream release was found at $API_ROOT/releases." >&2
    exit 1
  fi
fi

case "$TAG" in
  paseo-v*) VERSION=${TAG#paseo-v} ;;
  *) echo "Unsupported downstream release tag: $TAG" >&2; exit 1 ;;
esac

BUNDLE_NAME="paseo-web-cli-$VERSION-$PLATFORM_NAME-$ARCH"
ARCHIVE="$BUNDLE_NAME.tar.gz"
CHECKSUM="$ARCHIVE.sha256"
ARCHIVE_URL="$DOWNLOAD_ROOT/$TAG/$ARCHIVE"
CHECKSUM_URL="$DOWNLOAD_ROOT/$TAG/$CHECKSUM"

printf 'Installing Paseo Foundation Downstream %s for %s %s\n' "$VERSION" "$PLATFORM_NAME" "$ARCH"
curl --fail --silent --show-error --location --retry 3 "$ARCHIVE_URL" -o "$TEMP_ROOT/$ARCHIVE"
curl --fail --silent --show-error --location --retry 3 "$CHECKSUM_URL" -o "$TEMP_ROOT/$CHECKSUM"

EXPECTED_SHA256=$(awk 'NR == 1 { print $1; exit }' "$TEMP_ROOT/$CHECKSUM")
case "$EXPECTED_SHA256" in
  ""|*[!0-9a-f]*) echo "Downloaded checksum is not a lowercase SHA-256 digest." >&2; exit 1 ;;
esac
if [ "${#EXPECTED_SHA256}" -ne 64 ]; then
  echo "Downloaded checksum is not 64 hexadecimal characters." >&2
  exit 1
fi
if [ "$SHA_COMMAND" = "shasum" ]; then
  ACTUAL_SHA256=$(shasum -a 256 "$TEMP_ROOT/$ARCHIVE" | awk '{ print $1 }')
else
  ACTUAL_SHA256=$(sha256sum "$TEMP_ROOT/$ARCHIVE" | awk '{ print $1 }')
fi
if [ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]; then
  echo "SHA-256 verification failed for $ARCHIVE." >&2
  exit 1
fi

tar -xzf "$TEMP_ROOT/$ARCHIVE" -C "$TEMP_ROOT"
BUNDLE="$TEMP_ROOT/$BUNDLE_NAME"
if [ ! -x "$BUNDLE/install.sh" ] || [ ! -f "$BUNDLE/manifest.json" ]; then
  echo "Downloaded release does not contain the expected downstream bundle." >&2
  exit 1
fi
if ! grep -q '"product": "Paseo WebUI + CLI"' "$BUNDLE/manifest.json" || \
   ! grep -q "\"platform\": \"$MANIFEST_PLATFORM\"" "$BUNDLE/manifest.json" || \
   ! grep -q "\"arch\": \"$ARCH\"" "$BUNDLE/manifest.json"; then
  echo "Downloaded release manifest does not match this host." >&2
  exit 1
fi

exec "$BUNDLE/install.sh" "$@"
