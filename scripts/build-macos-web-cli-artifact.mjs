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
import { fileURLToPath } from "node:url";

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
    const output = run(
      "npm",
      ["pack", "--silent", "--json", `--workspace=${workspace}`, `--pack-destination=${PACK_ROOT}`],
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

function installerScript() {
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

PASEO_BIN=$(escape_xml "$CURRENT_LINK/bin/paseo")
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
    <string>$PASEO_BIN</string><string>daemon</string><string>start</string>
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
  launchctl bootstrap "gui/$USER_ID" "$PLIST"
  launchctl kickstart -k "gui/$USER_ID/$LABEL"
fi

cp "$RELEASE_DIR/uninstall.sh" "$PREFIX/uninstall.sh"
chmod 755 "$PREFIX/uninstall.sh"
printf 'Installed Paseo WebUI + CLI %s at %s\\n' "$VERSION" "$RELEASE_DIR"
printf 'CLI: %s\\n' "$BIN_DIR/paseo"
printf 'WebUI: http://%s\\n' "$LISTEN"
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
    manifest.cliIncluded !== true
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

function main() {
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
}

main();
