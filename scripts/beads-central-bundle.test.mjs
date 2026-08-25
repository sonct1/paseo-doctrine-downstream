import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const repoRoot = new URL("../", import.meta.url);
const lock = JSON.parse(
  readFileSync(new URL("components/beads-central.lock.json", repoRoot), "utf8"),
);
const sourceRoot = new URL("components/beads-central-src/", repoRoot);
const buildSource = readFileSync(
  new URL("scripts/build-beads-central-sidecar.mjs", repoRoot),
  "utf8",
);
const nixPackageSource = readFileSync(new URL("nix/package.nix", repoRoot), "utf8");
const nixBeadsCentralSource = readFileSync(new URL("nix/beads-central.nix", repoRoot), "utf8");
const nixFlakeSource = readFileSync(new URL("flake.nix", repoRoot), "utf8");
const smokeSource = readFileSync(new URL("scripts/smoke-web-cli-artifact.mjs", repoRoot), "utf8");
const attributesSource = readFileSync(new URL(".gitattributes", repoRoot), "utf8");
const centralSourceFiles = [
  "LICENSE",
  "README.md",
  "beads_central/__init__.py",
  "beads_central/auth.py",
  "beads_central/beads.py",
  "beads_central/body_limit.py",
  "beads_central/control_store.py",
  "beads_central/instance_lock.py",
  "beads_central/main.py",
  "beads_central/mcp.py",
  "beads_central/models.py",
  "beads_central/projects.py",
  "beads_central/service.py",
  "beads_central/settings.py",
  "constraints.txt",
  "pyproject.toml",
  "third_party/BEADS_SOURCE_SHA256.txt",
  "third_party/NOTICE.md",
  "uv.lock",
].sort();

function vendoredCentralSourceSha256() {
  const hash = createHash("sha256");
  for (const relativePath of centralSourceFiles) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(readFileSync(new URL(relativePath, sourceRoot)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

test("vendored Beads Central source matches the release lock", () => {
  assert.equal(
    readFileSync(new URL("SOURCE_COMMIT", sourceRoot), "utf8").trim(),
    lock.sourceCommit,
  );
  assert.equal(vendoredCentralSourceSha256(), lock.centralSourceSha256);
  assert.match(
    readFileSync(new URL("beads_central/__init__.py", sourceRoot), "utf8"),
    new RegExp(`__version__ = "${lock.version.replaceAll(".", "\\.")}"`),
  );
  assert.match(
    readFileSync(new URL("third_party/BEADS_SOURCE_SHA256.txt", sourceRoot), "utf8"),
    new RegExp(`^${lock.beadsSourceSha256}  beads-${lock.beadsVersion}\\.tar\\.gz`, "u"),
  );
  assert.equal(existsSync(new URL("uv.lock", sourceRoot)), true);
  assert.match(lock.beadsSourceUrl, /^https:\/\/github\.com\/steveyegge\/beads\//u);
  assert.match(attributesSource, /^components\/beads-central-src\/\*\* -text$/mu);
});

test("host-native builder can provision real Central and bd from a clean checkout", () => {
  assert.match(buildSource, /components", "beads-central-src/);
  assert.match(buildSource, /await fetch\(LOCK\.beadsSourceUrl/);
  assert.match(buildSource, /archiveSha !== LOCK\.beadsSourceSha256/);
  assert.match(buildSource, /"go",\s*\[\s*"build"/u);
  assert.match(buildSource, /process\.platform === "win32" \? "bd\.exe" : "bd"/);
  assert.doesNotMatch(buildSource, /prebuilt Windows bd binary is required/i);
  assert.match(buildSource, /"--locked",\s*"--project"/u);
  assert.match(buildSource, /verbatimSymlinks: true/);
  assert.match(buildSource, /assertPortableSymlinks\(output\)/);
});

test("portable smoke requires and starts the real installed Central component", () => {
  assert.match(smokeSource, /manifest\.bundledBeadsBinary !== true/);
  assert.match(smokeSource, /componentManifest\.sidecarBinarySha256 !== sha256/);
  assert.match(smokeSource, /componentManifest\.beadsBinarySha256 !== sha256/);
  assert.match(smokeSource, /await waitForBeadsCentral\(\)/);
  assert.match(smokeSource, /beads_central=\$\{\s*beadsReady\.central\s*\}/u);
});

test("Nix daemon package owns the immutable Central and bd bundle", () => {
  assert.match(nixFlakeSource, /nix\/beads-central\.nix/);
  assert.match(nixFlakeSource, /inherit beadsCentral/);
  assert.match(nixPackageSource, /PASEO_BEADS_CENTRAL_SIDECAR/);
  assert.match(nixPackageSource, /PASEO_BEADS_CENTRAL_BD_BIN/);
  assert.match(nixBeadsCentralSource, /fetchurl/);
  assert.match(nixBeadsCentralSource, /buildGo126Module/);
  assert.match(nixBeadsCentralSource, /go_1_26\.overrideAttrs/);
  assert.match(nixBeadsCentralSource, /buildGo126Module\.override \{ go = go1262; \}/);
  assert.match(nixBeadsCentralSource, /go1\.26\.2\.src\.tar\.gz/);
  assert.match(nixBeadsCentralSource, /sha256-LpHrtpR6lulDb7KzkmqIAu\/mOm03Xf\/sT4Kqnb1v1Ds=/);
  assert.match(
    nixBeadsCentralSource,
    /vendorHash = "sha256-WWEwGpCwMPD7jaz02zN745RQQqYTQttehbcT3J9hayM="/,
  );
  assert.doesNotMatch(nixBeadsCentralSource, /go 1\.26\.1/);
  assert.match(nixBeadsCentralSource, /beadsSourceSha256/);
  assert.match(nixBeadsCentralSource, /python3Packages/);
});
