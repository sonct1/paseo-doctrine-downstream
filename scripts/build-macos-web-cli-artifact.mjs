import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const ARTIFACTS_ROOT = path.join(REPO_ROOT, "artifacts");
const packageJson = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
const VERSION = packageJson.version;
const ARCH = process.arch;
const PLATFORM = process.platform;
const BUNDLE_NAME = `paseo-web-cli-${VERSION}-macos-${ARCH}`;
const STAGING_ROOT = path.join(ARTIFACTS_ROOT, ".staging", BUNDLE_NAME);
const PACK_ROOT = path.join(ARTIFACTS_ROOT, ".staging", "packs");
const OUTPUT_DIR = path.join(ARTIFACTS_ROOT, BUNDLE_NAME);
const OUTPUT_TARBALL = path.join(ARTIFACTS_ROOT, `${BUNDLE_NAME}.tar.gz`);
const OUTPUT_CHECKSUM = `${OUTPUT_TARBALL}.sha256`;
const BEADS_CENTRAL_VERSION = "1.2.0";
const INTERNAL_PACKAGES = [
  "@getpaseo/highlight",
  "@getpaseo/relay",
  "@getpaseo/protocol",
  "@getpaseo/client",
  "@getpaseo/server",
  "@getpaseo/cli",
  "@getpaseo/foundation-cli",
];

function fail(message) {
  throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: options.env ?? process.env,
  });
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stdout ?? ""}${result.stderr ?? ""}` : "";
    fail(`${command} ${args.join(" ")} failed with exit ${result.status}${detail}`);
  }
  return options.capture ? result.stdout.trim() : "";
}

function writeExecutable(target, bytes) {
  writeFileSync(target, bytes, { mode: 0o755 });
  chmodSync(target, 0o755);
}

function resolveBundledNodeRoot() {
  const override = process.env.PASEO_RELEASE_NODE_ROOT;
  const candidates = [
    override,
    path.join(os.homedir(), ".nvm", "versions", "node", "v24.11.0"),
    path.dirname(path.dirname(process.execPath)),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const node = path.join(candidate, "bin", "node");
    const npm = path.join(candidate, "bin", "npm");
    const license = path.join(candidate, "LICENSE");
    if (existsSync(node) && existsSync(npm) && existsSync(license)) return realpathSync(candidate);
  }
  fail(
    "Could not locate a relocatable Node distribution. Set PASEO_RELEASE_NODE_ROOT to a Node installation containing bin/node, bin/npm, and LICENSE.",
  );
}

function assertReleaseInputs(nodeRoot) {
  if (PLATFORM !== "darwin")
    fail(`macOS artifact builds require darwin; current platform is ${PLATFORM}`);
  if (ARCH !== "arm64" && ARCH !== "x64") fail(`Unsupported macOS architecture: ${ARCH}`);
  const dirty = run("git", ["status", "--porcelain"], { capture: true });
  if (dirty && process.env.PASEO_RELEASE_ALLOW_DIRTY !== "1") {
    fail(
      "Refusing to build a release artifact from a dirty worktree. Set PASEO_RELEASE_ALLOW_DIRTY=1 only for a local candidate build.",
    );
  }
  const bundledArch = run(path.join(nodeRoot, "bin", "node"), ["-p", "process.arch"], {
    capture: true,
  });
  if (bundledArch !== ARCH) {
    fail(`Bundled Node architecture ${bundledArch} does not match build architecture ${ARCH}`);
  }
}

function buildProduct() {
  run("npm", ["run", "build:server:clean"]);
  run("npm", ["run", "build:daemon-web-ui"]);
  run(process.execPath, ["packages/foundation-cli/prepare-assets.mjs"]);
  run("npm", ["run", "build", "--workspace=@getpaseo/foundation-cli"]);
}

function packInternalPackages() {
  rmSync(PACK_ROOT, { recursive: true, force: true });
  mkdirSync(PACK_ROOT, { recursive: true });
  const tarballs = [];
  for (const workspace of INTERNAL_PACKAGES) {
    // buildProduct() already built every package in INTERNAL_PACKAGES. Do not let npm pack rerun
    // prepack hooks that clean those shared outputs or rebuild the daemon web UI a second time.
    const output = run(
      "npm",
      [
        "pack",
        "--silent",
        "--json",
        "--ignore-scripts",
        `--workspace=${workspace}`,
        `--pack-destination=${PACK_ROOT}`,
      ],
      { capture: true },
    );
    const packed = parseTrailingJson(output, workspace);
    if (packed.length !== 1 || !packed[0]?.filename)
      fail(`Unexpected npm pack result for ${workspace}`);
    tarballs.push(path.join(PACK_ROOT, packed[0].filename));
  }
  return tarballs;
}

function parseTrailingJson(output, label) {
  for (
    let index = output.lastIndexOf("[");
    index >= 0;
    index = output.lastIndexOf("[", index - 1)
  ) {
    try {
      return JSON.parse(output.slice(index));
    } catch {
      // npm lifecycle scripts may write progress before the final --json payload.
    }
  }
  fail(`Could not parse trailing npm JSON for ${label}`);
}

function installProductionPayload(nodeRoot, tarballs) {
  const appRoot = path.join(STAGING_ROOT, "app");
  mkdirSync(appRoot, { recursive: true });
  writeFileSync(
    path.join(appRoot, "package.json"),
    `${JSON.stringify({ name: "paseo-web-cli-runtime", private: true, version: VERSION }, null, 2)}\n`,
  );
  const npmEnv = {
    ...process.env,
    PATH: `${path.join(nodeRoot, "bin")}:/usr/bin:/bin:/usr/sbin:/sbin`,
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
  };
  run(
    path.join(nodeRoot, "bin", "npm"),
    ["install", "--omit=dev", "--no-package-lock", "--no-save", `--prefix=${appRoot}`, ...tarballs],
    { env: npmEnv },
  );
}

function copyNodeRuntime(nodeRoot) {
  const runtimeRoot = path.join(STAGING_ROOT, "runtime");
  mkdirSync(path.join(runtimeRoot, "bin"), { recursive: true });
  copyFileSync(path.join(nodeRoot, "bin", "node"), path.join(runtimeRoot, "bin", "node"));
  chmodSync(path.join(runtimeRoot, "bin", "node"), 0o755);
  for (const name of ["LICENSE", "README.md"]) {
    const source = path.join(nodeRoot, name);
    if (existsSync(source)) copyFileSync(source, path.join(runtimeRoot, `NODE-${name}`));
  }
}

function createLaunchers() {
  const binRoot = path.join(STAGING_ROOT, "bin");
  mkdirSync(binRoot, { recursive: true });
  writeExecutable(
    path.join(binRoot, "paseo"),
    `#!/bin/sh
set -eu
SOURCE=$0
while [ -L "$SOURCE" ]; do
  SOURCE_DIR=$(CDPATH= cd -- "$(dirname -- "$SOURCE")" && pwd -P)
  SOURCE_TARGET=$(readlink "$SOURCE")
  case "$SOURCE_TARGET" in
    /*) SOURCE=$SOURCE_TARGET ;;
    *) SOURCE=$SOURCE_DIR/$SOURCE_TARGET ;;
  esac
done
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$SOURCE")" && pwd -P)
ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
exec "$ROOT/runtime/bin/node" "$ROOT/app/node_modules/@getpaseo/cli/dist/index.js" "$@"
`,
  );
  writeExecutable(
    path.join(binRoot, "paseo-foundation"),
    `#!/bin/sh
set -eu
SOURCE=$0
while [ -L "$SOURCE" ]; do
  SOURCE_DIR=$(CDPATH= cd -- "$(dirname -- "$SOURCE")" && pwd -P)
  SOURCE_TARGET=$(readlink "$SOURCE")
  case "$SOURCE_TARGET" in
    /*) SOURCE=$SOURCE_TARGET ;;
    *) SOURCE=$SOURCE_DIR/$SOURCE_TARGET ;;
  esac
done
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$SOURCE")" && pwd -P)
ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
exec "$ROOT/runtime/bin/node" "$ROOT/app/node_modules/@getpaseo/foundation-cli/dist/index.js" "$@"
`,
  );
}

export function installerScript() {
  return `#!/bin/sh
set -eu

VERSION=${shellQuote(VERSION)}
DEFAULT_LABEL="com.paseo.web-cli"
PREFIX="\${PASEO_INSTALL_PREFIX:-$HOME/.local/share/paseo-web-cli}"
BIN_DIR="\${PASEO_INSTALL_BIN_DIR:-$HOME/.local/bin}"
LISTEN="127.0.0.1:6767"
LABEL="$DEFAULT_LABEL"
START=1
INSTALL_FOUNDATION=1

usage() {
  cat <<'USAGE'
Usage: ./install.sh [options]

Install the Paseo WebUI + CLI macOS release for the current user.

Options:
  --prefix PATH          Release root (default: ~/.local/share/paseo-web-cli)
  --bin-dir PATH         CLI symlink directory (default: ~/.local/bin)
  --listen HOST:PORT     Daemon listen address (default: 127.0.0.1:6767)
  --label LABEL          launchd label (default: com.paseo.web-cli)
  --no-start             Install files and plist without loading launchd
  --skip-foundation      Do not install/update the bundled Foundation distribution
  -h, --help             Show this help without changing the machine
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --prefix) PREFIX="$2"; shift 2 ;;
    --bin-dir) BIN_DIR="$2"; shift 2 ;;
    --listen) LISTEN="$2"; shift 2 ;;
    --label) LABEL="$2"; shift 2 ;;
    --no-start) START=0; shift ;;
    --skip-foundation) INSTALL_FOUNDATION=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

case "$PREFIX:$BIN_DIR" in
  /*:/*) ;;
  *) echo "--prefix and --bin-dir must be absolute paths" >&2; exit 2 ;;
esac
if [ "$PREFIX" = "/" ] || [ "$BIN_DIR" = "/" ]; then
  echo "Refusing to install into /" >&2
  exit 2
fi
case "$LABEL" in
  *[!A-Za-z0-9._-]*|"") echo "Invalid launchd label: $LABEL" >&2; exit 2 ;;
esac

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
SOURCE_ROOT="$SCRIPT_DIR"
RELEASES_DIR="$PREFIX/releases"
RELEASE_DIR="$RELEASES_DIR/$VERSION"
CURRENT_LINK="$PREFIX/current"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
USER_ID=$(id -u)

EXISTING_PASEO=$(command -v paseo 2>/dev/null || true)
if [ -z "$EXISTING_PASEO" ]; then
  for candidate in "$HOME/.local/bin/paseo" "$PREFIX/current/bin/paseo" /opt/homebrew/bin/paseo /usr/local/bin/paseo; do
    if [ -x "$candidate" ]; then
      EXISTING_PASEO="$candidate"
      break
    fi
  done
fi
if [ "$START" -eq 1 ] && [ -n "$EXISTING_PASEO" ]; then
  PREFLIGHT_ROOT=$(mktemp -d "\${TMPDIR:-/tmp}/paseo-downstream-preflight.XXXXXX")
  trap 'rm -rf "$PREFLIGHT_ROOT"' EXIT INT TERM
  LAUNCHD_LOADED=0
  if launchctl print "gui/$USER_ID/$LABEL" >/dev/null 2>&1; then
    LAUNCHD_LOADED=1
  fi
  if ! PASEO_HOST= "$EXISTING_PASEO" daemon status --json > "$PREFLIGHT_ROOT/status.json"; then
    echo "Refusing to replace the existing Paseo installation because daemon status could not be read." >&2
    exit 1
  fi
  if grep -Eq '"localDaemon"[[:space:]]*:[[:space:]]*"(running|unresponsive)"' "$PREFLIGHT_ROOT/status.json"; then
    if ! PASEO_HOST= "$EXISTING_PASEO" ls --global --json > "$PREFLIGHT_ROOT/agents.json"; then
      echo "Refusing to stop the existing daemon because agent state could not be read." >&2
      exit 1
    fi
    if grep -Eq '"status"[[:space:]]*:[[:space:]]*"(running|starting|initializing)"' "$PREFLIGHT_ROOT/agents.json"; then
      echo "Refusing to replace Paseo while an agent is running or starting." >&2
      exit 1
    fi

    if ! PASEO_HOST= "$EXISTING_PASEO" workspace ls --json > "$PREFLIGHT_ROOT/workspaces.json"; then
      echo "Refusing to stop the existing daemon because workspace state could not be read." >&2
      exit 1
    fi
    awk -F '"' '/"workspaceId"[[:space:]]*:/ { print $4 }' "$PREFLIGHT_ROOT/workspaces.json" |
      while IFS= read -r workspace_id; do
        [ -n "$workspace_id" ] || continue
        scripts_file="$PREFLIGHT_ROOT/scripts-$workspace_id.json"
        if ! PASEO_HOST= "$EXISTING_PASEO" script ls --workspace "$workspace_id" --json > "$scripts_file"; then
          echo "Refusing to stop the existing daemon because scripts for workspace $workspace_id could not be read." >&2
          exit 1
        fi
        if grep -Eq '"lifecycle"[[:space:]]*:[[:space:]]*"(running|starting)"' "$scripts_file"; then
          echo "Refusing to replace Paseo while workspace $workspace_id has a running script." >&2
          exit 1
        fi
      done

    if [ "$LAUNCHD_LOADED" -eq 1 ]; then
      # The launchd job owns the supervisor process and KeepAlive will respawn it if only the
      # worker receives the daemon shutdown RPC. Remove the owner first, then wait for Paseo's
      # authoritative stopped readback before replacing the installed release.
      printf 'Existing idle launchd-managed Paseo detected at %s; unloading it before activation.\n' "$EXISTING_PASEO"
      if ! launchctl bootout "gui/$USER_ID/$LABEL"; then
        echo "Existing Paseo launchd service could not be unloaded; installation aborted." >&2
        exit 1
      fi
    else
      printf 'Existing idle unmanaged Paseo detected at %s; stopping it before activation.\n' "$EXISTING_PASEO"
      PASEO_HOST= "$EXISTING_PASEO" daemon stop --json >/dev/null
    fi

    STOPPED=0
    for _attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
      if PASEO_HOST= "$EXISTING_PASEO" daemon status --json > "$PREFLIGHT_ROOT/stopped.json" 2>/dev/null &&
         grep -Eq '"localDaemon"[[:space:]]*:[[:space:]]*"stopped"' "$PREFLIGHT_ROOT/stopped.json"; then
        STOPPED=1
        break
      fi
      sleep 1
    done
    if [ "$STOPPED" -ne 1 ]; then
      echo "Existing Paseo daemon did not report a stopped readback; installation aborted." >&2
      exit 1
    fi
  elif [ "$LAUNCHD_LOADED" -eq 1 ]; then
    echo "Refusing to replace a loaded Paseo launchd service whose daemon is not authoritatively running." >&2
    exit 1
  fi
  rm -rf "$PREFLIGHT_ROOT"
  trap - EXIT INT TERM
fi

mkdir -p "$RELEASES_DIR" "$BIN_DIR" "$HOME/Library/LaunchAgents"
STAGING="$RELEASES_DIR/.install-$VERSION-$$"
trap 'rm -rf "$STAGING"' EXIT INT TERM
rm -rf "$STAGING"
mkdir -p "$STAGING"
cp -R "$SOURCE_ROOT/." "$STAGING/"
rm -f "$STAGING/install.sh"
rm -rf "$RELEASE_DIR"
mv "$STAGING" "$RELEASE_DIR"
trap - EXIT INT TERM
ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"
ln -sfn "$CURRENT_LINK/bin/paseo" "$BIN_DIR/paseo"
ln -sfn "$CURRENT_LINK/bin/paseo-foundation" "$BIN_DIR/paseo-foundation"

if [ "$INSTALL_FOUNDATION" -eq 1 ]; then
  PLAN="$PREFIX/foundation-install-plan.json"
  MODE="clean-empty"
  if "$CURRENT_LINK/bin/paseo-foundation" inspect --json 2>/dev/null | grep -q '"status": "active"'; then
    MODE="update"
  fi
  "$CURRENT_LINK/bin/paseo-foundation" plan --mode "$MODE" --output "$PLAN"
  "$CURRENT_LINK/bin/paseo-foundation" install --plan "$PLAN"
fi

escape_xml() {
  printf '%s' "$1" | sed -e 's/&/\\&amp;/g' -e 's/</\\&lt;/g' -e 's/>/\\&gt;/g' -e 's/"/\\&quot;/g' -e "s/'/\\&apos;/g"
}

DAEMON_NODE="$CURRENT_LINK/runtime/bin/node"
HOST_NODE=$(command -v node 2>/dev/null || true)
if [ -n "$HOST_NODE" ] && [ -x "$HOST_NODE" ] &&
   "$HOST_NODE" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' >/dev/null 2>&1; then
  # A compatible user-installed Node retains macOS privacy grants that may not
  # carry over to the relocated bundled binary when launchd opens Desktop or Documents workspaces.
  DAEMON_NODE="$HOST_NODE"
fi
DAEMON_ENTRY="$CURRENT_LINK/app/node_modules/@getpaseo/cli/dist/index.js"
DAEMON_NODE_XML=$(escape_xml "$DAEMON_NODE")
DAEMON_ENTRY_XML=$(escape_xml "$DAEMON_ENTRY")
LISTEN_XML=$(escape_xml "$LISTEN")
PATH_XML=$(escape_xml "$BIN_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin")
LOG_DIR="$HOME/Library/Logs/Paseo"
mkdir -p "$LOG_DIR"
LOG_XML=$(escape_xml "$LOG_DIR/daemon.log")
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>$DAEMON_NODE_XML</string><string>$DAEMON_ENTRY_XML</string>
    <string>daemon</string><string>start</string>
    <string>--foreground</string><string>--listen</string><string>$LISTEN_XML</string>
    <string>--web-ui</string><string>--no-relay</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>HOME</key><string>$(escape_xml "$HOME")</string>
    <key>PATH</key><string>$PATH_XML</string>
    <key>PASEO_DICTATION_ENABLED</key><string>0</string>
    <key>PASEO_LOCAL_SPEECH_AUTO_DOWNLOAD</key><string>0</string>
    <key>PASEO_VOICE_MODE_ENABLED</key><string>0</string>
  </dict>
  <key>KeepAlive</key><true/><key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>$LOG_XML</string>
  <key>StandardErrorPath</key><string>$LOG_XML</string>
</dict></plist>
PLIST
plutil -lint "$PLIST" >/dev/null

if [ "$START" -eq 1 ]; then
  launchctl bootout "gui/$USER_ID/$LABEL" >/dev/null 2>&1 || true
  BOOTSTRAPPED=0
  BOOTSTRAP_ERROR=""
  for _attempt in 1 2 3 4 5 6 7 8 9 10; do
    if BOOTSTRAP_ERROR=$(launchctl bootstrap "gui/$USER_ID" "$PLIST" 2>&1); then
      BOOTSTRAPPED=1
      break
    fi
    sleep 1
  done
  if [ "$BOOTSTRAPPED" -ne 1 ]; then
    [ -z "$BOOTSTRAP_ERROR" ] || printf '%s\n' "$BOOTSTRAP_ERROR" >&2
    echo "Installed the release, but launchd activation remained unavailable after retries." >&2
    exit 1
  fi
  launchctl kickstart -k "gui/$USER_ID/$LABEL"
  READY=0
  for _attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
    if PASEO_HOST= "$CURRENT_LINK/bin/paseo" daemon status --json > "$PREFIX/daemon-readback.json" 2>/dev/null &&
       grep -Eq '"localDaemon"[[:space:]]*:[[:space:]]*"running"' "$PREFIX/daemon-readback.json" &&
       grep -Eq '"connectedDaemon"[[:space:]]*:[[:space:]]*"reachable"' "$PREFIX/daemon-readback.json"; then
      READY=1
      break
    fi
    sleep 1
  done
  rm -f "$PREFIX/daemon-readback.json"
  if [ "$READY" -ne 1 ]; then
    echo "Installed the release, but the downstream daemon failed authoritative startup readback." >&2
    echo "Inspect $LOG_DIR/daemon.log before retrying." >&2
    exit 1
  fi
fi

cp "$RELEASE_DIR/uninstall.sh" "$PREFIX/uninstall.sh"
chmod 755 "$PREFIX/uninstall.sh"
printf 'Installed Paseo WebUI + CLI %s at %s\\n' "$VERSION" "$RELEASE_DIR"
printf 'CLI: %s\\n' "$BIN_DIR/paseo"
printf 'WebUI: http://%s\\n' "$LISTEN"
ACTIVE_PASEO=$(command -v paseo 2>/dev/null || true)
if [ "$ACTIVE_PASEO" != "$BIN_DIR/paseo" ]; then
  printf 'PATH notice: add %s to PATH before any other Paseo installation.\\n' "$BIN_DIR" >&2
fi
`;
}

function uninstallerScript() {
  return `#!/bin/sh
set -eu

PREFIX="\${PASEO_INSTALL_PREFIX:-$HOME/.local/share/paseo-web-cli}"
BIN_DIR="\${PASEO_INSTALL_BIN_DIR:-$HOME/.local/bin}"
LABEL="\${PASEO_LAUNCHD_LABEL:-com.paseo.web-cli}"
PURGE_FOUNDATION=0

usage() {
  cat <<'USAGE'
Usage: uninstall.sh [--purge-foundation]

Removes the Paseo WebUI + CLI release and launchd service. User data in ~/.paseo
is always preserved. The bundled Foundation installation is preserved unless
--purge-foundation is explicitly supplied.
USAGE
}

case "\${1:-}" in
  "") ;;
  --purge-foundation) PURGE_FOUNDATION=1 ;;
  -h|--help) usage; exit 0 ;;
  *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
esac

case "$PREFIX:$BIN_DIR" in
  /*:/*) ;;
  *) echo "PASEO_INSTALL_PREFIX and PASEO_INSTALL_BIN_DIR must be absolute paths" >&2; exit 2 ;;
esac
if [ "$PREFIX" = "/" ] || [ "$BIN_DIR" = "/" ]; then
  echo "Refusing to uninstall from /" >&2
  exit 2
fi
case "$LABEL" in
  *[!A-Za-z0-9._-]*|"") echo "Invalid launchd label: $LABEL" >&2; exit 2 ;;
esac

USER_ID=$(id -u)
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootout "gui/$USER_ID/$LABEL" >/dev/null 2>&1 || true
rm -f "$PLIST"

if [ "$PURGE_FOUNDATION" -eq 1 ] && [ -x "$PREFIX/current/bin/paseo-foundation" ]; then
  "$PREFIX/current/bin/paseo-foundation" uninstall
fi

for name in paseo paseo-foundation; do
  target="$BIN_DIR/$name"
  if [ -L "$target" ]; then
    resolved=$(readlink "$target")
    case "$resolved" in
      "$PREFIX"/*) rm -f "$target" ;;
    esac
  fi
done

rm -rf "$PREFIX/releases" "$PREFIX/current" "$PREFIX/foundation-install-plan.json"
rm -f "$PREFIX/uninstall.sh"
printf 'Removed Paseo WebUI + CLI. Preserved ~/.paseo and user workspaces.\\n'
`;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function createInstallScripts() {
  writeExecutable(path.join(STAGING_ROOT, "install.sh"), installerScript());
  writeExecutable(path.join(STAGING_ROOT, "uninstall.sh"), uninstallerScript());
}

function walkFiles(root, relative = "") {
  const output = [];
  for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) output.push(...walkFiles(root, child));
    else if (entry.isFile()) output.push(child);
  }
  return output.sort();
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function createManifest(nodeRoot) {
  const commit = run("git", ["rev-parse", "HEAD"], { capture: true });
  const gitDirty = Boolean(run("git", ["status", "--porcelain"], { capture: true }));
  const nodeVersion = run(path.join(nodeRoot, "bin", "node"), ["--version"], { capture: true });
  const webUiRoot = path.join(STAGING_ROOT, "app/node_modules/@getpaseo/server/dist/server/web-ui");
  if (!statSync(webUiRoot).isDirectory())
    fail("Packaged server is missing the daemon WebUI bundle");
  const manifest = {
    schemaVersion: 1,
    product: "Paseo WebUI + CLI",
    version: VERSION,
    platform: "darwin",
    arch: ARCH,
    gitCommit: commit,
    gitDirty,
    nodeVersion,
    electronIncluded: false,
    webUiIncluded: true,
    cliIncluded: true,
    foundationIncluded: true,
    beadsBackend: "central",
    beadsCentralClientIncluded: true,
    beadsCentralRequiredVersion: BEADS_CENTRAL_VERSION,
    bundledBeadsBinary: false,
    internalPackages: Object.fromEntries(
      INTERNAL_PACKAGES.map((name) => [
        name,
        JSON.parse(
          readFileSync(
            path.join(STAGING_ROOT, "app/node_modules", ...name.split("/"), "package.json"),
          ),
        ).version,
      ]),
    ),
  };
  writeFileSync(path.join(STAGING_ROOT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const checksums = walkFiles(STAGING_ROOT)
    .filter((name) => name !== "SHA256SUMS")
    .map((name) => `${sha256(path.join(STAGING_ROOT, name))}  ${name}`)
    .join("\n");
  writeFileSync(path.join(STAGING_ROOT, "SHA256SUMS"), `${checksums}\n`);
}

function validateStaging(nodeRoot) {
  run(path.join(STAGING_ROOT, "bin", "paseo"), ["--version"]);
  run(path.join(STAGING_ROOT, "bin", "paseo-foundation"), ["--version"]);
  const manifest = JSON.parse(readFileSync(path.join(STAGING_ROOT, "manifest.json"), "utf8"));
  if (
    manifest.version !== VERSION ||
    manifest.platform !== "darwin" ||
    manifest.arch !== ARCH ||
    manifest.electronIncluded !== false ||
    manifest.webUiIncluded !== true ||
    manifest.cliIncluded !== true ||
    manifest.beadsBackend !== "central" ||
    manifest.beadsCentralClientIncluded !== true ||
    manifest.beadsCentralRequiredVersion !== BEADS_CENTRAL_VERSION ||
    manifest.bundledBeadsBinary !== false
  ) {
    fail("Artifact manifest validation failed");
  }
  const bundledNodeVersion = run(path.join(STAGING_ROOT, "runtime", "bin", "node"), ["--version"], {
    capture: true,
  });
  const sourceNodeVersion = run(path.join(nodeRoot, "bin", "node"), ["--version"], {
    capture: true,
  });
  if (bundledNodeVersion !== sourceNodeVersion) fail("Bundled Node validation failed");
  if (existsSync(path.join(STAGING_ROOT, "runtime", "bin", "bd"))) {
    fail("Central-only artifact must not bundle a native bd binary");
  }
}

function emitArtifact() {
  rmSync(OUTPUT_DIR, { recursive: true, force: true });
  rmSync(OUTPUT_TARBALL, { force: true });
  rmSync(OUTPUT_CHECKSUM, { force: true });
  mkdirSync(ARTIFACTS_ROOT, { recursive: true });
  cpSync(STAGING_ROOT, OUTPUT_DIR, { recursive: true });
  run("/usr/bin/tar", ["-czf", OUTPUT_TARBALL, "-C", ARTIFACTS_ROOT, BUNDLE_NAME], {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  writeFileSync(OUTPUT_CHECKSUM, `${sha256(OUTPUT_TARBALL)}  ${path.basename(OUTPUT_TARBALL)}\n`);
  const sizeMiB = (statSync(OUTPUT_TARBALL).size / 1024 / 1024).toFixed(2);
  process.stdout.write(
    `\nArtifact: ${OUTPUT_TARBALL}\nSHA-256: ${sha256(OUTPUT_TARBALL)}\nSize: ${sizeMiB} MiB\n`,
  );
}

// Every step below mutates shared, unversioned output: packages/*/dist, packages/app/dist,
// packages/foundation-cli/assets and artifacts/.staging. Two artifact builds at once therefore
// clean directories the other is compiling against, and the loser fails somewhere unrelated to
// the real cause. mkdir is atomic, so it doubles as the lock.
const BUILD_LOCK_DIR = path.join(ARTIFACTS_ROOT, ".build-lock");

function acquireArtifactLock() {
  mkdirSync(ARTIFACTS_ROOT, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      mkdirSync(BUILD_LOCK_DIR);
      writeFileSync(path.join(BUILD_LOCK_DIR, "pid"), String(process.pid), "utf8");
      return;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let owner = Number.NaN;
      try {
        owner = Number.parseInt(readFileSync(path.join(BUILD_LOCK_DIR, "pid"), "utf8"), 10);
      } catch {
        owner = Number.NaN;
      }
      if (Number.isInteger(owner) && isProcessAlive(owner)) {
        fail(
          `Another artifact build is running (pid ${owner}). Wait for it, or remove ${BUILD_LOCK_DIR} if that process is gone.`,
        );
      }
      rmSync(BUILD_LOCK_DIR, { recursive: true, force: true });
    }
  }
  fail(`Could not acquire ${BUILD_LOCK_DIR}`);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function main() {
  acquireArtifactLock();
  try {
    const nodeRoot = resolveBundledNodeRoot();
    assertReleaseInputs(nodeRoot);
    rmSync(STAGING_ROOT, { recursive: true, force: true });
    mkdirSync(STAGING_ROOT, { recursive: true });
    buildProduct();
    const tarballs = packInternalPackages();
    installProductionPayload(nodeRoot, tarballs);
    copyNodeRuntime(nodeRoot);
    createLaunchers();
    createInstallScripts();
    createManifest(nodeRoot);
    validateStaging(nodeRoot);
    emitArtifact();
  } finally {
    rmSync(BUILD_LOCK_DIR, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
