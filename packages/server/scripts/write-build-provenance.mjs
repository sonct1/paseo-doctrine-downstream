import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, "..");
const repositoryRoot = realpathSync(resolve(packageRoot, "../.."));
const outputPath = resolve(packageRoot, "dist/server/build-provenance.json");
const roleSourcePath = resolve(
  repositoryRoot,
  "foundation/dist/profiles/native/role-definitions.json",
);
const roleOutputPath = resolve(
  packageRoot,
  "dist/server/server/agent/foundation-role-definitions.json",
);

function git(args, options = {}) {
  return execFileSync("git", ["-C", repositoryRoot, ...args], {
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}

const sourceCommit = git(["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const trackedDiff = git(["diff", "--binary", "--no-ext-diff", "HEAD", "--"]);
const untrackedOutput = git(["ls-files", "--others", "--exclude-standard", "-z"], {
  encoding: "utf8",
});
const untrackedPaths = untrackedOutput.split("\0").filter(Boolean).sort();

const fingerprint = createHash("sha256");
fingerprint.update("paseo-source-fingerprint-v1\0");
fingerprint.update(sourceCommit);
fingerprint.update("\0tracked-diff\0");
fingerprint.update(trackedDiff);
for (const relativePath of untrackedPaths) {
  const absolutePath = resolve(repositoryRoot, relativePath);
  const stat = lstatSync(absolutePath);
  fingerprint.update("\0untracked\0");
  fingerprint.update(relativePath);
  fingerprint.update("\0");
  if (stat.isSymbolicLink()) {
    fingerprint.update(`symlink:${readlinkSync(absolutePath)}`);
  } else {
    fingerprint.update(readFileSync(absolutePath));
  }
}

const provenance = {
  schemaVersion: 1,
  sourceRoot: repositoryRoot,
  sourceCommit,
  sourceDirty: trackedDiff.length > 0 || untrackedPaths.length > 0,
  sourceFingerprint: fingerprint.digest("hex"),
  builtAt: new Date().toISOString(),
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(provenance, null, 2)}\n`, "utf8");
mkdirSync(dirname(roleOutputPath), { recursive: true });
copyFileSync(roleSourcePath, roleOutputPath);
