#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const LOCK_PATH = path.join(REPO_ROOT, "components", "beads-central.lock.json");
const ENTRYPOINT = path.join(REPO_ROOT, "scripts", "beads-central-sidecar-entry.py");
const LOCK = JSON.parse(readFileSync(LOCK_PATH, "utf8"));
const MATERIAL_SOURCE_PATHS = [
  "beads_central",
  "pyproject.toml",
  "constraints.txt",
  "LICENSE",
  "third_party/BEADS_SOURCE_SHA256.txt",
  "third_party/NOTICE.md",
  "third_party/source-archives/beads-1.1.2.tar.gz",
];

function fail(message) {
  throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    encoding: "utf8",
    env: options.env ?? process.env,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stdout ?? ""}${result.stderr ?? ""}` : "";
    fail(`${command} ${args.join(" ")} failed with exit ${String(result.status)}${detail}`);
  }
  return options.capture ? result.stdout.trim() : "";
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function parseArgs(argv) {
  let output = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--output") {
      output = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    fail(`Unknown argument: ${argument}`);
  }
  if (!output) fail("Usage: build-beads-central-sidecar.mjs --output <directory>");
  const resolved = path.resolve(output);
  if (resolved === path.parse(resolved).root || resolved === REPO_ROOT) {
    fail(`Refusing unsafe sidecar output: ${resolved}`);
  }
  return { output: resolved };
}

function resolveCentralRoot() {
  const configured = process.env.PASEO_BEADS_CENTRAL_SOURCE_ROOT?.trim();
  const candidate = configured || path.resolve(REPO_ROOT, "../beads-central");
  if (!existsSync(candidate)) {
    fail(
      `Canonical Beads Central source is missing: ${candidate}. Set PASEO_BEADS_CENTRAL_SOURCE_ROOT.`,
    );
  }
  return realpathSync(candidate);
}

function verifyCentralSource(centralRoot) {
  const commit = run("git", ["rev-parse", "HEAD"], { cwd: centralRoot, capture: true });
  if (commit !== LOCK.sourceCommit) {
    fail(`Beads Central source commit mismatch: expected ${LOCK.sourceCommit}, received ${commit}`);
  }
  const materialStatus = run(
    "git",
    ["status", "--porcelain", "--untracked-files=all", "--", ...MATERIAL_SOURCE_PATHS],
    {
      cwd: centralRoot,
      capture: true,
    },
  );
  if (materialStatus) {
    fail("Beads Central material source paths are dirty; commit or revert them before packaging");
  }
  const archive = path.join(
    centralRoot,
    "third_party",
    "source-archives",
    `beads-${LOCK.beadsVersion}.tar.gz`,
  );
  const archiveSha = sha256(archive);
  if (archiveSha !== LOCK.beadsSourceSha256) {
    fail(
      `Bundled Beads source checksum mismatch: expected ${LOCK.beadsSourceSha256}, received ${archiveSha}`,
    );
  }
  return archive;
}

function resolveBdBinary(centralRoot, temporaryRoot) {
  const configured = process.env.PASEO_BEADS_BD_BIN?.trim();
  const prebuilt =
    configured || path.join(centralRoot, "dist", process.platform === "win32" ? "bd.exe" : "bd");
  if (existsSync(prebuilt)) return realpathSync(prebuilt);
  const output = path.join(temporaryRoot, process.platform === "win32" ? "bd.exe" : "bd");
  if (process.platform === "win32") {
    fail("A prebuilt Windows bd binary is required via PASEO_BEADS_BD_BIN");
  }
  run("bash", [path.join(centralRoot, "scripts", "build_bd_from_bundled_source.sh"), output], {
    cwd: centralRoot,
  });
  return output;
}

function verifyBdBinary(bdBinary) {
  const version = run(bdBinary, ["version"], { capture: true });
  if (!version.startsWith(`bd version ${LOCK.beadsVersion}`)) {
    fail(`Bundled bd version mismatch: ${version}`);
  }
  return version;
}

function buildPythonSidecar(centralRoot, temporaryRoot) {
  const distRoot = path.join(temporaryRoot, "dist");
  const workRoot = path.join(temporaryRoot, "work");
  const specRoot = path.join(temporaryRoot, "spec");
  const uv = process.env.PASEO_UV_BIN?.trim() || "uv";
  run(
    uv,
    [
      "run",
      "--project",
      centralRoot,
      "--with",
      `pyinstaller==${LOCK.pyinstallerVersion}`,
      "pyinstaller",
      "--noconfirm",
      "--clean",
      "--onedir",
      "--name",
      "beads-central",
      "--distpath",
      distRoot,
      "--workpath",
      workRoot,
      "--specpath",
      specRoot,
      "--paths",
      centralRoot,
      "--collect-all",
      "uvicorn",
      "--collect-all",
      "fastapi",
      "--collect-all",
      "pydantic",
      "--collect-all",
      "yaml",
      ENTRYPOINT,
    ],
    { cwd: REPO_ROOT },
  );
  const bundleRoot = path.join(distRoot, "beads-central");
  const executable = path.join(
    bundleRoot,
    process.platform === "win32" ? "beads-central.exe" : "beads-central",
  );
  if (!existsSync(executable)) fail(`PyInstaller output is missing: ${executable}`);
  return bundleRoot;
}

function extractBeadsLicense(archive, target) {
  const result = spawnSync("tar", ["-xOf", archive, `beads-${LOCK.beadsVersion}/LICENSE`], {
    encoding: null,
  });
  if (result.status !== 0 || !result.stdout) {
    fail("Could not extract the bundled Beads license from the pinned source archive");
  }
  writeFileSync(target, result.stdout);
}

function assemble(output, centralRoot, archive, pythonBundle, bdBinary, bdVersion) {
  rmSync(output, { recursive: true, force: true });
  mkdirSync(path.dirname(output), { recursive: true });
  cpSync(pythonBundle, output, { recursive: true });
  const binRoot = path.join(output, "bin");
  const licensesRoot = path.join(output, "licenses");
  mkdirSync(binRoot, { recursive: true });
  mkdirSync(licensesRoot, { recursive: true });
  const bundledBd = path.join(binRoot, process.platform === "win32" ? "bd.exe" : "bd");
  copyFileSync(bdBinary, bundledBd);
  copyFileSync(path.join(centralRoot, "LICENSE"), path.join(licensesRoot, "beads-central-LICENSE"));
  copyFileSync(
    path.join(centralRoot, "third_party", "NOTICE.md"),
    path.join(licensesRoot, "NOTICE.md"),
  );
  extractBeadsLicense(archive, path.join(licensesRoot, "beads-LICENSE"));
  if (process.platform !== "win32") {
    chmodSync(path.join(output, "beads-central"), 0o755);
    chmodSync(bundledBd, 0o755);
  }
  const manifest = {
    schemaVersion: 1,
    component: "beads-central",
    version: LOCK.version,
    sourceCommit: LOCK.sourceCommit,
    platform: process.platform,
    arch: process.arch,
    pyinstallerVersion: LOCK.pyinstallerVersion,
    beadsVersion: LOCK.beadsVersion,
    beadsSourceSha256: LOCK.beadsSourceSha256,
    beadsBinarySha256: sha256(bundledBd),
    beadsRuntime: bdVersion,
  };
  writeFileSync(
    path.join(output, "component-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

function main() {
  const { output } = parseArgs(process.argv.slice(2));
  const centralRoot = resolveCentralRoot();
  const archive = verifyCentralSource(centralRoot);
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "paseo-beads-sidecar-build."));
  try {
    const bdBinary = resolveBdBinary(centralRoot, temporaryRoot);
    const bdVersion = verifyBdBinary(bdBinary);
    const pythonBundle = buildPythonSidecar(centralRoot, temporaryRoot);
    assemble(output, centralRoot, archive, pythonBundle, bdBinary, bdVersion);
    process.stdout.write(`Bundled Beads Central ${LOCK.version} sidecar at ${output}\n`);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main();
