#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = realpathSync(path.resolve(path.dirname(SCRIPT_PATH), ".."));
const OUTPUT_ROOT = path.join(REPO_ROOT, "foundation", "dist");
const FOUNDATION_MANIFEST = path.join(REPO_ROOT, "foundation", "manifest.json");
const SOURCES_LOCK = path.join(REPO_ROOT, "foundation", "sources.lock.json");

const FILES = [
  "AGENTS.md",
  "docs/ASSIGNMENT_AND_HANDBACK.md",
  "docs/PORTABLE_BOOTSTRAP_AND_ROUTING.md",
  "docs/ROLE_CONTRACTS.md",
  "docs/ROLE_INSTRUCTION_BINDING.md",
  "docs/SUPERVISOR_NOTEBOOK.md",
  "references/demonthorn-agent-orchestration-deep-dive.md",
  "references/demonthorn-codex-room-refs/Test-rule-hard-cut-rule.txt",
  "references/structural-anti-patterns.md",
  "scripts/antigravity-role",
  "scripts/codex-cliproxy-profile.py",
  "scripts/codex-profile",
  "scripts/codex-profile.py",
  "scripts/omp-role",
];

const DIRECTORIES = ["profiles", "skills", "templates"];

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) fail(`unexpected argument: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`missing value for ${argument}`);
    options[argument.slice(2)] = value;
    index += 1;
  }
  for (const required of ["source", "foundation-ref", "foundation-version", "paseo-upstream-ref"]) {
    if (!options[required]) fail(`missing --${required}`);
  }
  return options;
}

function git(source, args) {
  return execFileSync("git", ["-C", source, ...args], { encoding: "utf8" }).trim();
}

function gitBytes(source, args) {
  return execFileSync("git", ["-C", source, ...args], { maxBuffer: 20 * 1024 * 1024 });
}

function assertSafeOutputRoot() {
  const expected = path.join(REPO_ROOT, "foundation", "dist");
  if (
    OUTPUT_ROOT !== expected ||
    path.dirname(OUTPUT_ROOT) !== path.join(REPO_ROOT, "foundation")
  ) {
    fail(`refusing unsafe Foundation output root: ${OUTPUT_ROOT}`);
  }
}

function readGitTree(source, commit) {
  const output = gitBytes(source, ["ls-tree", "-r", "-z", commit, "--", ...FILES, ...DIRECTORIES]);
  const entries = output
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const separator = record.indexOf("\t");
      if (separator < 0) fail(`unexpected git ls-tree record: ${record}`);
      const [mode, type, object] = record.slice(0, separator).split(" ");
      const relativePath = record.slice(separator + 1);
      if (
        !relativePath ||
        path.posix.isAbsolute(relativePath) ||
        path.posix.normalize(relativePath) !== relativePath ||
        relativePath.split("/").includes("..") ||
        [...relativePath].some((character) => {
          const codePoint = character.codePointAt(0);
          return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
        })
      ) {
        fail(`unsafe Foundation source path: ${JSON.stringify(relativePath)}`);
      }
      if (type !== "blob" || !["100644", "100755"].includes(mode)) {
        fail(
          `Foundation distribution accepts only regular tracked files: ${relativePath} (${mode} ${type})`,
        );
      }
      return { mode, object, path: relativePath };
    });
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  for (const requiredFile of FILES) {
    if (!byPath.has(requiredFile)) fail(`missing tracked Foundation source file: ${requiredFile}`);
  }
  if (byPath.size !== entries.length) fail("Foundation Git tree contains duplicate selected paths");
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function copyDirectory(source, destination) {
  cpSync(source, destination, { recursive: true, force: false, errorOnExist: true });
}

function buildProviderSkillProjections(distributionVersion) {
  const bundlePath = path.join(OUTPUT_ROOT, "skills", "role-bundles.json");
  const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
  if (bundle.schemaVersion !== 1 || typeof bundle.roles !== "object" || bundle.roles === null) {
    fail("invalid Foundation role bundle manifest");
  }

  for (const role of ["lead", "peer", "supervisor"]) {
    const roleBundle = bundle.roles[role];
    if (
      !roleBundle ||
      !Array.isArray(roleBundle.active) ||
      !Array.isArray(roleBundle.explicitOnly)
    ) {
      fail(`invalid Foundation role bundle: ${role}`);
    }
    const admitted = [...roleBundle.active, ...roleBundle.explicitOnly];
    if (new Set(admitted).size !== admitted.length) fail(`duplicate admitted skill: ${role}`);

    const claudeRoot = path.join(OUTPUT_ROOT, "profiles", "claude-plugins", `paseo-${role}`);
    mkdirSync(path.join(claudeRoot, ".claude-plugin"), { recursive: true, mode: 0o755 });
    mkdirSync(path.join(claudeRoot, "agents"), { recursive: true, mode: 0o755 });
    writeFileSync(
      path.join(claudeRoot, ".claude-plugin", "plugin.json"),
      `${JSON.stringify(
        {
          name: `paseo-${role}`,
          description: `Paseo ${role} role-bound skill projection`,
          version: distributionVersion,
          author: { name: "Paseo Foundation" },
        },
        null,
        2,
      )}\n`,
    );
    cpSync(
      path.join(OUTPUT_ROOT, "profiles", "claude", `paseo-${role}.md`),
      path.join(claudeRoot, "agents", `paseo-${role}.md`),
    );

    const openCodeRoot = path.join(OUTPUT_ROOT, "profiles", "opencode-role-roots", role);
    for (const skillName of admitted) {
      const skillSource = path.join(OUTPUT_ROOT, "skills", skillName);
      if (!statSync(path.join(skillSource, "SKILL.md")).isFile()) {
        fail(`admitted Foundation skill is missing: ${skillName}`);
      }
      copyDirectory(skillSource, path.join(claudeRoot, "skills", skillName));
      copyDirectory(skillSource, path.join(openCodeRoot, "skills", skillName));
      copyDirectory(
        skillSource,
        path.join(OUTPUT_ROOT, "profiles", "cursor", `paseo-${role}`, "skills", skillName),
      );
    }
  }
}

function distributionFiles(root, prefix = "") {
  const files = [];
  for (const entry of readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const relativePath = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...distributionFiles(root, relativePath));
    else if (entry.isFile()) files.push(relativePath);
    else fail(`generated Foundation distribution contains a non-regular file: ${relativePath}`);
  }
  return files;
}

function writeJsonAtomic(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o644 });
  renameSync(temporary, filePath);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const source = realpathSync(path.resolve(options.source));
  const sourceHead = git(source, ["rev-parse", "HEAD"]);
  const requestedRef = git(source, ["rev-parse", `${options["foundation-ref"]}^{commit}`]);
  if (sourceHead !== requestedRef) {
    fail(`Foundation source HEAD ${sourceHead} does not match requested ref ${requestedRef}`);
  }
  const sourceStatus = git(source, ["status", "--porcelain"]);
  if (sourceStatus) fail("Foundation source must be clean before import");

  const sourceFiles = readGitTree(source, sourceHead);

  assertSafeOutputRoot();
  rmSync(OUTPUT_ROOT, { recursive: true, force: true });
  mkdirSync(OUTPUT_ROOT, { recursive: true, mode: 0o755 });

  for (const sourceFile of sourceFiles) {
    const relativePath = sourceFile.path;
    const destinationPath = path.join(OUTPUT_ROOT, relativePath);
    mkdirSync(path.dirname(destinationPath), { recursive: true, mode: 0o755 });
    const bytes = gitBytes(source, ["show", `${sourceHead}:${relativePath}`]);
    writeFileSync(destinationPath, bytes);
    const mode = sourceFile.mode === "100755" ? 0o755 : 0o644;
    chmodSync(destinationPath, mode);
  }

  buildProviderSkillProjections(options["foundation-version"]);
  const manifestFiles = distributionFiles(OUTPUT_ROOT)
    .sort()
    .map((relativePath) => {
      const filePath = path.join(OUTPUT_ROOT, relativePath);
      return {
        path: relativePath,
        mode: (statSync(filePath).mode & 0o777).toString(8).padStart(4, "0"),
        sha256: sha256(filePath),
      };
    });

  const manifest = {
    schemaVersion: 1,
    distributionVersion: options["foundation-version"],
    foundationSource: {
      commit: sourceHead,
      ref: options["foundation-ref"],
    },
    files: manifestFiles,
  };
  writeJsonAtomic(FOUNDATION_MANIFEST, manifest);
  writeJsonAtomic(SOURCES_LOCK, {
    schemaVersion: 1,
    foundation: manifest.foundationSource,
    paseoUpstream: {
      commit: options["paseo-upstream-ref"],
      remote: "https://github.com/getpaseo/paseo.git",
    },
  });

  process.stdout.write(
    `Imported ${manifestFiles.length} Foundation files from ${sourceHead} as ${manifest.distributionVersion}\n`,
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`import-foundation: ${message}\n`);
  process.exitCode = 1;
}
