#!/bin/sh
set -eu

REPOSITORY="webplode/paseo-doctrine-downstream"
API_ROOT="${PASEO_DOWNSTREAM_API_ROOT:-https://api.github.com/repos/$REPOSITORY}"
DOWNLOAD_ROOT="${PASEO_DOWNSTREAM_DOWNLOAD_ROOT:-https://github.com/$REPOSITORY/releases/download}"
TAG="${PASEO_DOWNSTREAM_TAG:-}"

usage() {
  cat <<'USAGE'
Usage: install-macos.sh [artifact installer options]

Download, verify, and install the newest Paseo Foundation Downstream macOS
release from webplode/paseo-doctrine-downstream.

Examples:
  ./install-macos.sh
  ./install-macos.sh --no-start
  PASEO_DOWNSTREAM_TAG=paseo-vX.Y.Z ./install-macos.sh

All options are forwarded to the verified artifact's install.sh. Run with
--help-artifact after download to inspect those options.
USAGE
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
esac

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This installer supports macOS only." >&2
  exit 1
fi

case "$(uname -m)" in
  arm64) ARCH="arm64" ;;
  x86_64) ARCH="x64" ;;
  *) echo "Unsupported macOS architecture: $(uname -m)" >&2; exit 1 ;;
esac

for command in awk curl grep shasum tar mktemp; do
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
  *)
    echo "Unsupported downstream release tag: $TAG" >&2
    echo "Expected a tag shaped like paseo-v<version>." >&2
    exit 1
    ;;
esac

BUNDLE_NAME="paseo-web-cli-$VERSION-macos-$ARCH"
ARCHIVE="$BUNDLE_NAME.tar.gz"
CHECKSUM="$ARCHIVE.sha256"
ARCHIVE_URL="$DOWNLOAD_ROOT/$TAG/$ARCHIVE"
CHECKSUM_URL="$DOWNLOAD_ROOT/$TAG/$CHECKSUM"

printf 'Installing Paseo Foundation Downstream %s for macOS %s\n' "$VERSION" "$ARCH"
printf 'Release: https://github.com/%s/releases/tag/%s\n' "$REPOSITORY" "$TAG"

curl --fail --silent --show-error --location --retry 3 "$ARCHIVE_URL" -o "$TEMP_ROOT/$ARCHIVE"
curl --fail --silent --show-error --location --retry 3 "$CHECKSUM_URL" -o "$TEMP_ROOT/$CHECKSUM"

EXPECTED_SHA256=$(awk 'NR == 1 { print $1; exit }' "$TEMP_ROOT/$CHECKSUM")
case "$EXPECTED_SHA256" in
  ""|*[!0-9a-f]*)
    echo "Downloaded checksum is not a lowercase SHA-256 digest." >&2
    exit 1
    ;;
esac
if [ "${#EXPECTED_SHA256}" -ne 64 ]; then
  echo "Downloaded checksum is not 64 hexadecimal characters." >&2
  exit 1
fi
ACTUAL_SHA256=$(shasum -a 256 "$TEMP_ROOT/$ARCHIVE" | awk '{ print $1 }')
if [ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]; then
  echo "SHA-256 verification failed for $ARCHIVE." >&2
  exit 1
fi
printf '%s: OK\n' "$ARCHIVE"

tar -xzf "$TEMP_ROOT/$ARCHIVE" -C "$TEMP_ROOT"
BUNDLE="$TEMP_ROOT/$BUNDLE_NAME"
if [ ! -x "$BUNDLE/install.sh" ] || [ ! -f "$BUNDLE/manifest.json" ]; then
  echo "Downloaded release does not contain the expected downstream bundle." >&2
  exit 1
fi
if ! grep -q '"product": "Paseo WebUI + CLI"' "$BUNDLE/manifest.json" || \
   ! grep -q '"platform": "darwin"' "$BUNDLE/manifest.json" || \
   ! grep -q "\"arch\": \"$ARCH\"" "$BUNDLE/manifest.json"; then
  echo "Downloaded release manifest does not match this macOS host." >&2
  exit 1
fi

if [ "${1:-}" = "--help-artifact" ]; then
  exec "$BUNDLE/install.sh" --help
fi

exec "$BUNDLE/install.sh" "$@"
