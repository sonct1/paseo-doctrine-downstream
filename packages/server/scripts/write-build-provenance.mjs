import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
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
const executionSpecializationSourcePath = resolve(
  repositoryRoot,
  "foundation/dist/profiles/native/execution-specializations.json",
);
const executionSpecializationOutputPath = resolve(
  packageRoot,
  "dist/server/server/agent/foundation-execution-specializations.json",
);
const productSkillsSourceRoot = resolve(repositoryRoot, "skills");
const productSkillAdmissionSourcePath = resolve(productSkillsSourceRoot, "role-admission.json");
const productSkillsOutputRoot = resolve(packageRoot, "dist/server/server/agent/product-skills");

function readProductSkillAdmission() {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(productSkillAdmissionSourcePath, "utf8"));
  } catch (error) {
    throw new Error(
      `Cannot read product role-skill admission at ${productSkillAdmissionSourcePath}`,
      { cause: error },
    );
  }
  if (
    manifest?.schemaVersion !== 1 ||
    !manifest.packages ||
    typeof manifest.packages !== "object" ||
    !manifest.roles ||
    typeof manifest.roles !== "object"
  ) {
    throw new Error("Product role-skill admission manifest is invalid");
  }
  const packageNames = Object.keys(manifest.packages);
  if (packageNames.length === 0 || packageNames.some((name) => !/^[a-z0-9-]+$/u.test(name))) {
    throw new Error("Product role-skill admission package names are invalid");
  }
  const packageSet = new Set(packageNames);
  for (const name of packageNames) {
    if (!existsSync(resolve(productSkillsSourceRoot, name, "SKILL.md"))) {
      throw new Error(`Product role-skill package '${name}' has no SKILL.md`);
    }
  }
  for (const role of ["lead", "peer", "supervisor"]) {
    const admission = manifest.roles[role];
    const states = admission
      ? [admission.active, admission.explicitOnly, admission.packagedDisabled]
      : [];
    if (
      states.length !== 3 ||
      states.some(
        (entries) => !Array.isArray(entries) || entries.some((name) => typeof name !== "string"),
      )
    ) {
      throw new Error(`Product role-skill admission for '${role}' is invalid`);
    }
    const names = states.flat();
    if (
      names.length !== packageNames.length ||
      new Set(names).size !== names.length ||
      names.some((name) => !packageSet.has(name))
    ) {
      throw new Error(`Product role-skill admission for '${role}' is not a full partition`);
    }
  }
  return packageNames.sort();
}

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
if (existsSync(executionSpecializationSourcePath)) {
  copyFileSync(executionSpecializationSourcePath, executionSpecializationOutputPath);
}

const productRoleSkillPackages = readProductSkillAdmission();
rmSync(productSkillsOutputRoot, { recursive: true, force: true });
mkdirSync(productSkillsOutputRoot, { recursive: true });
copyFileSync(
  productSkillAdmissionSourcePath,
  resolve(productSkillsOutputRoot, "role-admission.json"),
);
for (const packageName of productRoleSkillPackages) {
  cpSync(
    resolve(productSkillsSourceRoot, packageName),
    resolve(productSkillsOutputRoot, packageName),
    { recursive: true },
  );
}
