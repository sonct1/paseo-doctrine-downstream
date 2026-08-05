import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { inspectMachine } from "./inspection.js";
import { resolveInstallLayout, resolveProductLayout, roleLinks } from "./layout.js";
import {
  FoundationManifestSchema,
  InstallRecordSchema,
  type FoundationManifest,
  type InstallPlan,
  type InstallRecord,
} from "./schema.js";
import { createInstallPlanFromInspection, verifyPlanIdentity } from "./plan.js";

interface AppliedInstall {
  record: InstallRecord;
  createdRelease: boolean;
  createdControlHome: boolean;
}

function sha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function releaseWithin(releasesRoot: string, candidate: string | null): string | null {
  if (!candidate) return null;
  return isWithin(releasesRoot, candidate) ? candidate : null;
}

function assertOwnedTemporary(root: string, candidate: string): void {
  if (!isWithin(root, candidate) || !path.basename(candidate).includes(`-${process.pid}`)) {
    throw new Error(`refusing unsafe temporary path: ${candidate}`);
  }
}

function readManifest(filePath: string): FoundationManifest {
  const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
  return FoundationManifestSchema.parse(parsed);
}

function verifyDistribution(root: string, manifest: FoundationManifest): void {
  for (const file of manifest.files) {
    const filePath = path.resolve(root, file.path);
    if (!isWithin(root, filePath))
      throw new Error(`manifest path escapes distribution: ${file.path}`);
    if (!statSync(filePath).isFile()) throw new Error(`distribution file is missing: ${file.path}`);
    const actual = sha256(filePath);
    if (actual !== file.sha256) {
      throw new Error(`distribution checksum mismatch for ${file.path}: ${actual}`);
    }
  }
}

function linkTarget(linkPath: string): string | null {
  try {
    if (!lstatSync(linkPath).isSymbolicLink()) return null;
    return path.resolve(path.dirname(linkPath), readlinkSync(linkPath));
  } catch {
    return null;
  }
}

function atomicSymlink(source: string, target: string): void {
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.tmp`);
  rmSync(temporary, { force: true });
  symlinkSync(source, temporary);
  renameSync(temporary, target);
}

function restoreLink(target: string, previousTarget: string | null): void {
  if (previousTarget === null) {
    rmSync(target, { force: true });
    return;
  }
  atomicSymlink(previousTarget, target);
}

function writeJsonAtomic(filePath: string, value: unknown, mode: number): void {
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.tmp`,
  );
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode });
  renameSync(temporary, filePath);
}

function stageRelease(input: {
  distributionRoot: string;
  manifestPath: string;
  manifest: FoundationManifest;
  releasesRoot: string;
  releasePath: string;
}): boolean {
  if (existsSync(input.releasePath)) {
    const installedManifestPath = path.join(input.releasePath, ".foundation-manifest.json");
    const installedManifest = readManifest(installedManifestPath);
    if (installedManifest.distributionVersion !== input.manifest.distributionVersion) {
      throw new Error(`existing release has a different version: ${input.releasePath}`);
    }
    verifyDistribution(input.releasePath, installedManifest);
    return false;
  }
  mkdirSync(input.releasesRoot, { recursive: true, mode: 0o755 });
  const stagingPath = path.join(
    input.releasesRoot,
    `.${input.manifest.distributionVersion}-${process.pid}-staging`,
  );
  assertOwnedTemporary(input.releasesRoot, stagingPath);
  rmSync(stagingPath, { recursive: true, force: true });
  try {
    cpSync(input.distributionRoot, stagingPath, { recursive: true });
    cpSync(input.manifestPath, path.join(stagingPath, ".foundation-manifest.json"));
    verifyDistribution(stagingPath, input.manifest);
    renameSync(stagingPath, input.releasePath);
    return true;
  } catch (error) {
    rmSync(stagingPath, { recursive: true, force: true });
    throw error;
  }
}

function stageControlHome(templateRoot: string, controlHome: string): boolean {
  if (existsSync(controlHome)) return false;
  mkdirSync(path.dirname(controlHome), { recursive: true, mode: 0o700 });
  const stagingPath = `${controlHome}-${process.pid}-staging`;
  assertOwnedTemporary(path.dirname(controlHome), stagingPath);
  rmSync(stagingPath, { recursive: true, force: true });
  try {
    cpSync(templateRoot, stagingPath, { recursive: true });
    renameSync(stagingPath, controlHome);
    return true;
  } catch (error) {
    rmSync(stagingPath, { recursive: true, force: true });
    throw error;
  }
}

export function applyInstallPlan(plan: InstallPlan): AppliedInstall {
  verifyPlanIdentity(plan);
  if (process.platform !== "darwin") {
    throw new Error(`macOS is required; detected ${process.platform}`);
  }
  const inspection = inspectMachine({ home: plan.home, productRoot: plan.productRoot });
  const canonicalPlan = createInstallPlanFromInspection(plan.mode, inspection);
  if (canonicalPlan.planId !== plan.planId) {
    throw new Error(
      "install plan does not match current canonical machine targets; generate a fresh plan",
    );
  }
  if (canonicalPlan.blockers.length > 0) {
    throw new Error(`install plan is blocked:\n${canonicalPlan.blockers.join("\n")}`);
  }
  const product = resolveProductLayout(plan.productRoot);
  const manifest = readManifest(product.manifestPath);
  if (
    manifest.distributionVersion !== plan.distributionVersion ||
    manifest.foundationSource.commit !== plan.foundationCommit
  ) {
    throw new Error("Foundation distribution identity changed after planning");
  }
  verifyDistribution(product.distributionRoot, manifest);

  const install = resolveInstallLayout({
    home: plan.home,
    distributionVersion: plan.distributionVersion,
  });
  if (inspection.installRecord?.status === "active") {
    validateRecordOwnership(install.home, inspection.installRecord);
  }
  const priorRecordBytes = existsSync(install.installRecordPath)
    ? readFileSync(install.installRecordPath)
    : null;
  const previousCurrentTarget = linkTarget(plan.currentLink);
  const priorLinkTargets = plan.links.map((link) => ({
    target: link.target,
    previousTarget: linkTarget(link.target),
  }));
  let createdRelease = false;
  let createdControlHome = false;

  try {
    createdRelease = stageRelease({
      distributionRoot: product.distributionRoot,
      manifestPath: product.manifestPath,
      manifest,
      releasesRoot: install.releasesRoot,
      releasePath: install.releasePath,
    });
    atomicSymlink(install.releasePath, install.currentLink);
    for (const link of plan.links) atomicSymlink(link.source, link.target);
    createdControlHome = stageControlHome(product.controlTemplateRoot, install.controlHome);

    const existingRecord = inspection.installRecord;
    const previousReleasePath =
      existingRecord?.status === "active"
        ? existingRecord.releasePath
        : releaseWithin(install.releasesRoot, previousCurrentTarget);
    const record = InstallRecordSchema.parse({
      schemaVersion: 1,
      status: "active",
      mode: plan.mode,
      distributionVersion: manifest.distributionVersion,
      foundationCommit: manifest.foundationSource.commit,
      installedAt: new Date().toISOString(),
      releasePath: install.releasePath,
      currentLink: install.currentLink,
      controlHome: install.controlHome,
      installedLinks: plan.links.map(({ source, target }) => ({ source, target })),
      previousReleasePath:
        previousReleasePath && previousReleasePath !== install.releasePath
          ? previousReleasePath
          : null,
      legacyRecordPath: inspection.legacyInstallRecordPresent ? install.legacyRecordPath : null,
    });
    writeJsonAtomic(install.installRecordPath, record, 0o600);
    return { record, createdRelease, createdControlHome };
  } catch (error) {
    for (const priorLink of priorLinkTargets.toReversed()) {
      restoreLink(priorLink.target, priorLink.previousTarget);
    }
    restoreLink(plan.currentLink, previousCurrentTarget);
    if (createdControlHome) rmSync(install.controlHome, { recursive: true, force: true });
    if (createdRelease) rmSync(install.releasePath, { recursive: true, force: true });
    if (priorRecordBytes) {
      mkdirSync(path.dirname(install.installRecordPath), { recursive: true, mode: 0o700 });
      writeFileSync(install.installRecordPath, priorRecordBytes, { mode: 0o600 });
    } else {
      rmSync(install.installRecordPath, { force: true });
    }
    throw error;
  }
}

function validateRecordOwnership(home: string, record: InstallRecord): void {
  const install = resolveInstallLayout({ home, distributionVersion: record.distributionVersion });
  const expectedLinks = roleLinks({ home: install.home, releasePath: install.releasePath });
  const recordLinks = record.installedLinks.map(({ source, target }) => ({ source, target }));
  if (
    record.releasePath !== install.releasePath ||
    record.currentLink !== install.currentLink ||
    record.controlHome !== install.controlHome ||
    JSON.stringify(recordLinks) !== JSON.stringify(expectedLinks) ||
    (record.previousReleasePath !== null &&
      releaseWithin(install.releasesRoot, record.previousReleasePath) === null) ||
    (record.legacyRecordPath !== null && record.legacyRecordPath !== install.legacyRecordPath)
  ) {
    throw new Error("install record contains paths outside the canonical Foundation layout");
  }
}

function readActiveRecord(home: string): { record: InstallRecord; recordPath: string } {
  const provisional = resolveInstallLayout({ home, distributionVersion: "unknown" });
  const parsed: unknown = JSON.parse(readFileSync(provisional.installRecordPath, "utf8"));
  const record = InstallRecordSchema.parse(parsed);
  if (record.status !== "active") throw new Error("Paseo Foundation is not active");
  validateRecordOwnership(provisional.home, record);
  return { record, recordPath: provisional.installRecordPath };
}

export function rollbackInstall(home: string): InstallRecord {
  const { record, recordPath } = readActiveRecord(home);
  const previousReleasePath = record.previousReleasePath;
  if (!previousReleasePath || !existsSync(previousReleasePath)) {
    throw new Error("no previous Foundation release is available for rollback");
  }
  const previousManifest = readManifest(
    path.join(previousReleasePath, ".foundation-manifest.json"),
  );
  verifyDistribution(previousReleasePath, previousManifest);
  const previousLinks = record.installedLinks.map((link) => ({
    target: link.target,
    source: path.join(previousReleasePath, path.relative(record.releasePath, link.source)),
  }));
  const priorCurrentTarget = linkTarget(record.currentLink);
  const priorLinkTargets = record.installedLinks.map((link) => ({
    target: link.target,
    previousTarget: linkTarget(link.target),
  }));
  try {
    atomicSymlink(previousReleasePath, record.currentLink);
    for (const link of previousLinks) atomicSymlink(link.source, link.target);
    const rolledBack = InstallRecordSchema.parse({
      ...record,
      mode: "update",
      distributionVersion: previousManifest.distributionVersion,
      foundationCommit: previousManifest.foundationSource.commit,
      installedAt: new Date().toISOString(),
      releasePath: previousReleasePath,
      installedLinks: previousLinks,
      previousReleasePath: record.releasePath,
    });
    writeJsonAtomic(recordPath, rolledBack, 0o600);
    return rolledBack;
  } catch (error) {
    for (const priorLink of priorLinkTargets.toReversed()) {
      restoreLink(priorLink.target, priorLink.previousTarget);
    }
    restoreLink(record.currentLink, priorCurrentTarget);
    throw error;
  }
}

export function uninstallFoundation(home: string): InstallRecord {
  const { record, recordPath } = readActiveRecord(home);
  const priorCurrentTarget = linkTarget(record.currentLink);
  const priorLinkTargets = record.installedLinks.map((link) => ({
    target: link.target,
    previousTarget: linkTarget(link.target),
  }));
  try {
    for (const link of record.installedLinks) {
      if (linkTarget(link.target) === link.source) rmSync(link.target, { force: true });
    }
    if (linkTarget(record.currentLink) === record.releasePath)
      rmSync(record.currentLink, { force: true });
    const uninstalled = InstallRecordSchema.parse({
      ...record,
      status: "uninstalled",
      uninstalledAt: new Date().toISOString(),
    });
    writeJsonAtomic(recordPath, uninstalled, 0o600);
    return uninstalled;
  } catch (error) {
    for (const priorLink of priorLinkTargets.toReversed()) {
      restoreLink(priorLink.target, priorLink.previousTarget);
    }
    restoreLink(record.currentLink, priorCurrentTarget);
    throw error;
  }
}
