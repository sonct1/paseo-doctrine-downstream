import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "paseo-foundation-package-smoke-"));

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    ...options,
  });
}

function runCli(binPath, args) {
  return run(process.execPath, [binPath, ...args]);
}

try {
  const packRoot = path.join(temporaryRoot, "pack");
  const prefix = path.join(temporaryRoot, "prefix");
  const home = path.join(temporaryRoot, "home");
  const planPath = path.join(temporaryRoot, "install-plan.json");
  mkdirSync(packRoot, { recursive: true });
  mkdirSync(home, { recursive: true });

  const packed = JSON.parse(
    run("npm", [
      "pack",
      "--silent",
      "--json",
      "--workspace=@getpaseo/foundation-cli",
      `--pack-destination=${packRoot}`,
    ]),
  );
  assert.equal(packed.length, 1);
  const tarball = path.join(packRoot, packed[0].filename);
  assert.equal(existsSync(tarball), true);

  run("npm", [
    "install",
    "--ignore-scripts",
    "--no-package-lock",
    "--no-save",
    `--prefix=${prefix}`,
    tarball,
  ]);

  const binPath = path.join(
    prefix,
    "node_modules",
    "@getpaseo",
    "foundation-cli",
    "bin",
    "paseo-foundation",
  );
  runCli(binPath, ["plan", "--mode", "clean-empty", "--home", home, "--output", planPath]);
  runCli(binPath, ["install", "--plan", planPath]);

  const activeRecordPath = path.join(home, ".paseo-foundation", "install.json");
  const activeRecord = JSON.parse(readFileSync(activeRecordPath, "utf8"));
  assert.equal(activeRecord.status, "active");
  assert.equal(lstatSync(activeRecord.currentLink).isSymbolicLink(), true);
  assert.deepEqual(activeRecord.installedLinks, []);
  for (const link of activeRecord.previousLinks) assert.equal(existsSync(link.target), false);

  runCli(binPath, ["uninstall", "--home", home]);
  const uninstalledRecord = JSON.parse(readFileSync(activeRecordPath, "utf8"));
  assert.equal(uninstalledRecord.status, "uninstalled");
  assert.equal(existsSync(activeRecord.currentLink), false);
  for (const link of activeRecord.previousLinks) assert.equal(existsSync(link.target), false);
  assert.equal(existsSync(activeRecord.releasePath), true);
  assert.equal(activeRecord.controlHome, null);
  assert.equal(existsSync(path.join(home, ".paseo-control")), false);

  const controlHome = path.join(temporaryRoot, "control-home");
  const controlPlanPath = path.join(temporaryRoot, "control-plan.json");
  mkdirSync(controlHome, { recursive: true });
  runCli(binPath, [
    "plan",
    "--mode",
    "clean-empty",
    "--home",
    controlHome,
    "--with-control-workspace",
    "--output",
    controlPlanPath,
  ]);
  runCli(binPath, ["install", "--plan", controlPlanPath]);
  const controlRecordPath = path.join(controlHome, ".paseo-foundation", "install.json");
  const controlRecord = JSON.parse(readFileSync(controlRecordPath, "utf8"));
  assert.equal(controlRecord.controlHome, path.join(controlHome, ".paseo-control"));
  assert.equal(existsSync(path.join(controlRecord.controlHome, "PROJECT_INDEX.yaml")), true);
  runCli(binPath, ["uninstall", "--home", controlHome]);
  assert.equal(existsSync(path.join(controlRecord.controlHome, "PROJECT_INDEX.yaml")), true);

  if (process.platform !== "win32") {
    const migrationHome = path.join(temporaryRoot, "migration-home");
    const migrationPlanPath = path.join(temporaryRoot, "migration-plan.json");
    const legacyRelease = path.join(migrationHome, "legacy", "paseo-foundation", "release");
    const legacyTargets = [
      ".codex/lead.config.toml",
      ".codex/peer.config.toml",
      ".codex/supervisor.config.toml",
      ".codex/skills/paseo-supervisor",
      ".paseo/bin/codex-profile",
      ".paseo/bin/codex-profile.py",
      ".paseo/bin/codex-cliproxy-profile",
      ".paseo/bin/antigravity-role",
      ".paseo/bin/omp-role",
    ];
    const legacyLinks = legacyTargets.map((relativeTarget) => ({
      source: path.join(legacyRelease, relativeTarget),
      target: path.join(migrationHome, relativeTarget),
    }));
    mkdirSync(migrationHome, { recursive: true });
    for (const link of legacyLinks) {
      mkdirSync(path.dirname(link.target), { recursive: true });
      symlinkSync(link.source, link.target);
    }

    runCli(binPath, [
      "plan",
      "--mode",
      "migration",
      "--home",
      migrationHome,
      "--output",
      migrationPlanPath,
    ]);
    runCli(binPath, ["install", "--plan", migrationPlanPath]);
    const migrationRecordPath = path.join(migrationHome, ".paseo-foundation", "install.json");
    const migrationRecord = JSON.parse(readFileSync(migrationRecordPath, "utf8"));
    assert.deepEqual(migrationRecord.installedLinks, []);
    assert.deepEqual(
      migrationRecord.previousLinks
        .map(({ previousTarget }) => previousTarget)
        .filter((previousTarget) => previousTarget !== null),
      legacyLinks.map(({ source }) => source),
    );
    for (const link of legacyLinks) assert.equal(existsSync(link.target), false);
    runCli(binPath, ["uninstall", "--home", migrationHome]);
    for (const link of legacyLinks) assert.equal(existsSync(link.target), false);
  }

  process.stdout.write(`Foundation packaged lifecycle passed on ${process.version}\n`);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
