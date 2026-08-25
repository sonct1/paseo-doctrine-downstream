import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readlinkSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  installerScript as renderArtifactInstaller,
  linuxInstallerScript,
  windowsInstallerScript,
} from "./build-macos-web-cli-artifact.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const installer = path.join(scriptDir, "install-macos.sh");
const portableInstaller = path.join(scriptDir, "install.sh");
const windowsInstaller = path.join(scriptDir, "install-windows.ps1");
const artifactSmoke = path.join(scriptDir, "smoke-macos-web-cli-artifact.sh");
const packageLock = path.join(scriptDir, "..", "package-lock.json");

function writeExecutable(file, source) {
  writeFileSync(file, source, { mode: 0o755 });
  chmodSync(file, 0o755);
}

function createFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "paseo-bootstrap-test-"));
  const fixtures = path.join(root, "fixtures");
  const fakeBin = path.join(root, "bin");
  const bundleName = "paseo-web-cli-9.9.9-macos-arm64";
  const bundle = path.join(root, bundleName);
  mkdirSync(fixtures);
  mkdirSync(fakeBin);
  mkdirSync(bundle);
  writeExecutable(
    path.join(bundle, "install.sh"),
    `#!/bin/sh\nprintf '%s\\n' "$*" > "$INSTALL_RESULT"\n`,
  );
  writeFileSync(
    path.join(bundle, "manifest.json"),
    `${JSON.stringify(
      { product: "Paseo WebUI + CLI", platform: "darwin", arch: "arm64" },
      null,
      2,
    )}\n`,
  );
  const archive = `${bundleName}.tar.gz`;
  execFileSync("/usr/bin/tar", ["-czf", path.join(fixtures, archive), "-C", root, bundleName]);
  const digest = execFileSync("/usr/bin/shasum", ["-a", "256", path.join(fixtures, archive)], {
    encoding: "utf8",
  }).split(/\s+/)[0];
  writeFileSync(path.join(fixtures, `${archive}.sha256`), `${digest}  ${archive}\n`);
  writeFileSync(
    path.join(fixtures, "releases.json"),
    `${JSON.stringify([{ tag_name: "paseo-v9.9.9", prerelease: true }])}\n`,
  );
  writeExecutable(
    path.join(fakeBin, "uname"),
    `#!/bin/sh\ncase "$1" in -s) echo Darwin ;; -m) echo arm64 ;; *) exit 2 ;; esac\n`,
  );
  writeExecutable(
    path.join(fakeBin, "curl"),
    `#!/bin/sh
set -eu
output=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) output="$2"; shift 2 ;;
    http://*|https://*) url="$1"; shift ;;
    *) shift ;;
  esac
done
case "$url" in
  *'/releases?per_page=1') source="$FIXTURE_ROOT/releases.json" ;;
  *) source="$FIXTURE_ROOT/\${url##*/}" ;;
esac
if [ -n "$output" ]; then cp "$source" "$output"; else cat "$source"; fi
`,
  );
  return { root, fixtures, fakeBin, archive };
}

function runFixture(fixture, args = [], extraEnv = {}, script = installer) {
  return spawnSync("/bin/sh", [script, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fixture.fakeBin}:/usr/bin:/bin`,
      FIXTURE_ROOT: fixture.fixtures,
      INSTALL_RESULT: path.join(fixture.root, "installed.txt"),
      PASEO_DOWNSTREAM_API_ROOT: "https://fixture.invalid/api",
      PASEO_DOWNSTREAM_DOWNLOAD_ROOT: "https://fixture.invalid/download",
      TMPDIR: fixture.root,
      ...extraEnv,
    },
  });
}

function createArtifactFixture(existingPaseoSource) {
  const root = mkdtempSync(path.join(os.tmpdir(), "paseo-artifact-installer-test-"));
  const bundle = path.join(root, "bundle");
  const oldBin = path.join(root, "old-bin");
  mkdirSync(path.join(bundle, "bin"), { recursive: true });
  mkdirSync(path.join(bundle, "runtime", "bin"), { recursive: true });
  mkdirSync(oldBin);
  writeExecutable(path.join(bundle, "install.sh"), renderArtifactInstaller());
  writeExecutable(path.join(bundle, "uninstall.sh"), "#!/bin/sh\nexit 0\n");
  writeExecutable(
    path.join(bundle, "bin", "paseo"),
    `#!/bin/sh
case "$1 $2" in
  'daemon status') echo '{"localDaemon":"running","connectedDaemon":"reachable"}' ;;
esac
exit 0
`,
  );
  writeExecutable(
    path.join(bundle, "bin", "paseo-foundation"),
    '#!/bin/sh\n[ "${1:-}" != inspect ] || echo \'{"status":"inactive"}\'\nexit 0\n',
  );
  writeExecutable(
    path.join(bundle, "runtime", "bin", "node"),
    '#!/bin/sh\ncase "$*" in *process.stdout.write*) printf "127.0.0.1:6767" ;; esac\nexit 0\n',
  );
  writeExecutable(path.join(oldBin, "paseo"), existingPaseoSource);
  return {
    root,
    bundle,
    oldBin,
    home: path.join(root, "home"),
    prefix: path.join(root, "install"),
    binDir: path.join(root, "installed-bin"),
    marker: path.join(root, "existing-paseo.log"),
  };
}

function runArtifactFixture(fixture, args, extraEnv = {}) {
  mkdirSync(fixture.home);
  return spawnSync("/bin/sh", [path.join(fixture.bundle, "install.sh"), ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: fixture.home,
      PATH: `${fixture.oldBin}:/usr/bin:/bin`,
      EXISTING_PASEO_MARKER: fixture.marker,
      ...extraEnv,
    },
  });
}

test("selects the newest downstream release, verifies it, and forwards options", () => {
  const fixture = createFixture();
  try {
    const result = runFixture(fixture, ["--no-start"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(path.join(fixture.root, "installed.txt"), "utf8"), "--no-start\n");
    assert.match(result.stdout, /Paseo Foundation Downstream 9\.9\.9/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("portable Unix installer selects and verifies the matching macOS artifact", () => {
  const fixture = createFixture();
  try {
    const result = runFixture(fixture, ["--no-start"], {}, portableInstaller);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(path.join(fixture.root, "installed.txt"), "utf8"), "--no-start\n");
    assert.match(result.stdout, /for macos arm64/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("does not invoke the artifact installer after checksum failure", () => {
  const fixture = createFixture();
  try {
    writeFileSync(
      path.join(fixture.fixtures, `${fixture.archive}.sha256`),
      `bad  ${fixture.archive}\n`,
    );
    const result = runFixture(fixture);
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(path.join(fixture.root, "installed.txt")), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("help is side-effect free and does not require macOS or curl", () => {
  const fixture = createFixture();
  try {
    rmSync(path.join(fixture.fakeBin, "curl"));
    writeExecutable(path.join(fixture.fakeBin, "uname"), "#!/bin/sh\necho Linux\n");
    const before = new Set(readFileNames(fixture.root));
    const result = runFixture(fixture, ["--help"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage: install-macos\.sh/);
    assert.deepEqual(new Set(readFileNames(fixture.root)), before);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("artifact smoke uses stock macOS inspection commands", () => {
  const source = readFileSync(artifactSmoke, "utf8");
  assert.equal(source.includes("\nrg "), false);
  assert.equal(source.includes("\njq "), false);
  assert.match(source, /\/usr\/bin\/grep -Fq/);
});

test("artifact smoke normalizes Intel uname output to the x64 artifact name", () => {
  const source = readFileSync(artifactSmoke, "utf8");
  assert.match(source, /x86_64\) ARCH="x64"/);
  assert.match(source, /macos-\$ARCH/);
});

test("portable installers declare Linux and Windows host checks explicitly", () => {
  const unixSource = readFileSync(portableInstaller, "utf8");
  const windowsSource = readFileSync(windowsInstaller, "utf8");
  assert.match(unixSource, /Linux\) PLATFORM_NAME="linux"/);
  assert.match(unixSource, /sha256sum/);
  assert.match(windowsSource, /OSArchitecture/);
  assert.match(windowsSource, /Get-FileHash -Algorithm SHA256/);
  assert.match(windowsSource, /Manifest\.platform -ne "win32"/);
});

test("release lock retains Lightning CSS binaries for both macOS architectures", () => {
  const lock = JSON.parse(readFileSync(packageLock, "utf8"));
  for (const arch of ["arm64", "x64"]) {
    const entry = lock.packages[`node_modules/lightningcss-darwin-${arch}`];
    assert.equal(entry.version, "1.30.1");
    assert.deepEqual(entry.os, ["darwin"]);
    assert.deepEqual(entry.cpu, [arch]);
    assert.equal(entry.optional, true);
  }
});

test("artifact installer refuses takeover while an existing agent is running", () => {
  const fixture = createArtifactFixture(`#!/bin/sh
printf '%s\\n' "$*" >> "$EXISTING_PASEO_MARKER"
case "$1 $2" in
  'daemon status') echo '{"localDaemon":"running"}' ;;
  'ls --global') echo '[{"status":"running"}]' ;;
  *) exit 2 ;;
esac
`);
  try {
    const result = runArtifactFixture(fixture, [
      "--prefix",
      fixture.prefix,
      "--bin-dir",
      fixture.binDir,
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /agent is running or starting/);
    assert.equal(existsSync(fixture.prefix), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("artifact --no-start stages the downstream without inspecting or stopping Paseo", () => {
  const fixture = createArtifactFixture(`#!/bin/sh
printf '%s\\n' "$*" >> "$EXISTING_PASEO_MARKER"
exit 99
`);
  const bundledNode = path.join(fixture.bundle, "runtime", "bin", "node");
  rmSync(bundledNode);
  symlinkSync(process.execPath, bundledNode);
  try {
    const result = runArtifactFixture(fixture, [
      "--prefix",
      fixture.prefix,
      "--bin-dir",
      fixture.binDir,
      "--no-start",
      "--skip-foundation",
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(fixture.marker), false);
    assert.equal(existsSync(path.join(fixture.prefix, "current", "bin", "paseo")), true);
    assert.equal(existsSync(path.join(fixture.prefix, "current", "install.sh")), true);
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(fixture.prefix, "install-config.json"), "utf8")),
      { schemaVersion: 1, prefix: fixture.prefix, binDir: fixture.binDir },
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("artifact installer restores the previous release when a post-switch gate fails", () => {
  const fixture = createArtifactFixture("#!/bin/sh\nexit 99\n");
  const previous = path.join(fixture.prefix, "releases", "0.5.0-paseo.37");
  mkdirSync(previous, { recursive: true });
  writeExecutable(path.join(previous, "install.sh"), "#!/bin/sh\nexit 0\n");
  symlinkSync(previous, path.join(fixture.prefix, "current"));
  writeExecutable(
    path.join(fixture.bundle, "bin", "paseo-foundation"),
    `#!/bin/sh
case "\${1:-}" in
  inspect) echo '{"status": "inactive"}' ;;
  install) exit 17 ;;
esac
exit 0
`,
  );
  try {
    const result = runArtifactFixture(fixture, [
      "--prefix",
      fixture.prefix,
      "--bin-dir",
      fixture.binDir,
      "--no-start",
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /restoring the previous Paseo release/);
    assert.equal(readlinkSync(path.join(fixture.prefix, "current")), previous);
    assert.equal(existsSync(path.join(fixture.prefix, "releases", "0.5.0-paseo.41")), false);
    assert.equal(existsSync(path.join(previous, "install.sh")), true);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("all generated platform installers preserve service config and gate the transaction", () => {
  const macos = renderArtifactInstaller();
  const linux = linuxInstallerScript();
  const windows = windowsInstallerScript();

  assert.match(macos, /if \[ ! -f "\$PLIST" \]/);
  assert.match(linux, /if \[ ! -f "\$UNIT" \]/);
  assert.match(windows, /if \(-not \$RunDaemonExisted\)/);
  assert.match(windows, /if \(-not \$TaskExisted\)/);
  for (const source of [macos, linux, windows]) {
    assert.match(source, /api\/health/);
    assert.match(source, /6769\/health\/ready/);
    assert.match(source, /restoring the previous Paseo release/i);
  }
  for (const source of [macos, linux]) {
    assert.match(source, /HEALTHY=0[\s\S]*6769\/health\/ready[\s\S]*sleep 1/);
    assert.match(source, /if \[ "\$HEALTHY" -ne 1 \]/);
  }
  assert.match(windows, /\$Healthy = \$false[\s\S]*foreach \(\$attempt in 1\.\.30\)/);
  assert.match(
    windows,
    /if \(-not \$Healthy\) \{ throw "Installed release failed health, WebUI, or Beads Central readback\." \}/,
  );
});

test("artifact installer prefers a compatible host Node for the launchd daemon", () => {
  const fixture = createArtifactFixture("#!/bin/sh\nexit 99\n");
  const hostNode = path.join(fixture.oldBin, "node");
  writeExecutable(
    hostNode,
    `#!/bin/sh
case "$1" in
  -e) exit 0 ;;
  *) exit 2 ;;
esac
`,
  );
  try {
    const result = runArtifactFixture(fixture, [
      "--prefix",
      fixture.prefix,
      "--bin-dir",
      fixture.binDir,
      "--no-start",
      "--skip-foundation",
    ]);
    assert.equal(result.status, 0, result.stderr);
    const plist = readFileSync(
      path.join(fixture.home, "Library", "LaunchAgents", "com.paseo.web-cli.plist"),
      "utf8",
    );
    assert.match(plist, new RegExp(`<string>${hostNode}</string>`));
    assert.match(
      plist,
      new RegExp(
        `<string>${fixture.prefix}/current/app/node_modules/@getpaseo/cli/dist/index.js</string>`,
      ),
    );
    assert.match(
      plist,
      new RegExp(
        `<key>PASEO_BEADS_CENTRAL_SIDECAR</key><string>${fixture.prefix}/current/components/beads-central/beads-central</string>`,
      ),
    );
    assert.match(
      plist,
      new RegExp(
        `<key>PASEO_BEADS_CENTRAL_BD_BIN</key><string>${fixture.prefix}/current/components/beads-central/bin/bd</string>`,
      ),
    );
    assert.doesNotMatch(plist, /PASEO_BEADS_BINARY/u);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("artifact installer unloads a KeepAlive launchd owner before replacing an idle daemon", () => {
  const fixture = createArtifactFixture(`#!/bin/sh
printf '%s\\n' "$*" >> "$EXISTING_PASEO_MARKER"
case "$1 $2" in
  'daemon status')
    if [ -f "$LAUNCHD_BOOTED_OUT" ]; then
      echo '{"localDaemon":"stopped"}'
    else
      echo '{"localDaemon":"running"}'
    fi
    ;;
  'ls --global') echo '[]' ;;
  'workspace ls') echo '[]' ;;
  'daemon stop') exit 88 ;;
  *) exit 2 ;;
esac
`);
  const launchctlLog = path.join(fixture.root, "launchctl.log");
  const bootstrapFailed = path.join(fixture.root, "bootstrap-failed");
  const launchdBootedOut = path.join(fixture.root, "launchd-booted-out");
  writeExecutable(
    path.join(fixture.oldBin, "launchctl"),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$LAUNCHCTL_LOG"
case "$1" in
  print) exit 0 ;;
  bootout) : > "$LAUNCHD_BOOTED_OUT"; exit 0 ;;
  kickstart) exit 0 ;;
  bootstrap)
    if [ ! -f "$LAUNCHCTL_BOOTSTRAP_FAILED" ]; then
      : > "$LAUNCHCTL_BOOTSTRAP_FAILED"
      exit 5
    fi
    exit 0
    ;;
  *) exit 2 ;;
esac
`,
  );
  try {
    const result = runArtifactFixture(
      fixture,
      ["--prefix", fixture.prefix, "--bin-dir", fixture.binDir, "--skip-foundation"],
      {
        LAUNCHCTL_LOG: launchctlLog,
        LAUNCHCTL_BOOTSTRAP_FAILED: bootstrapFailed,
        LAUNCHD_BOOTED_OUT: launchdBootedOut,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const paseoCalls = readFileSync(fixture.marker, "utf8").trim().split("\n");
    assert.equal(
      paseoCalls.some((line) => line.startsWith("daemon stop")),
      false,
    );
    const launchctlCalls = readFileSync(launchctlLog, "utf8").trim().split("\n");
    const firstBootout = launchctlCalls.findIndex((line) => line.startsWith("bootout "));
    const firstBootstrap = launchctlCalls.findIndex((line) => line.startsWith("bootstrap "));
    assert.notEqual(firstBootout, -1);
    assert.equal(firstBootout < firstBootstrap, true);
    assert.equal(launchctlCalls.filter((line) => line.startsWith("bootstrap ")).length, 2);
    assert.equal(
      launchctlCalls.some((line) => line.startsWith("kickstart -k ")),
      true,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("artifact installer stops an idle unmanaged daemon through the CLI", () => {
  const fixture = createArtifactFixture(`#!/bin/sh
printf '%s\\n' "$*" >> "$EXISTING_PASEO_MARKER"
case "$1 $2" in
  'daemon status')
    if [ -f "$EXISTING_PASEO_STOPPED" ]; then
      echo '{"localDaemon":"stopped"}'
    else
      echo '{"localDaemon":"running"}'
    fi
    ;;
  'ls --global') echo '[]' ;;
  'workspace ls') echo '[]' ;;
  'daemon stop') : > "$EXISTING_PASEO_STOPPED"; echo '{}' ;;
  *) exit 2 ;;
esac
`);
  const launchctlLog = path.join(fixture.root, "launchctl.log");
  writeExecutable(
    path.join(fixture.oldBin, "launchctl"),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$LAUNCHCTL_LOG"
case "$1" in
  print) exit 1 ;;
  bootout|bootstrap|kickstart) exit 0 ;;
  *) exit 2 ;;
esac
`,
  );
  try {
    const result = runArtifactFixture(
      fixture,
      ["--prefix", fixture.prefix, "--bin-dir", fixture.binDir, "--skip-foundation"],
      {
        EXISTING_PASEO_STOPPED: path.join(fixture.root, "existing-paseo-stopped"),
        LAUNCHCTL_LOG: launchctlLog,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const paseoCalls = readFileSync(fixture.marker, "utf8").trim().split("\n");
    assert.equal(
      paseoCalls.some((line) => line.startsWith("daemon stop")),
      true,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

function readFileNames(root) {
  const output = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      output.push(path.relative(root, fullPath));
      if (entry.isDirectory()) visit(fullPath);
    }
  };
  visit(root);
  return output.sort();
}
