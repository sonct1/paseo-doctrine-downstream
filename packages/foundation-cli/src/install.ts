import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { inspectMachine } from "./inspection.js";
import {
  foundationSkillNamesFromTargets,
  resolveInstallLayout,
  resolveProductLayout,
  legacyRoleLinks,
} from "./layout.js";
import {
  FoundationManifestSchema,
  InstallPlanSchema,
  InstallRecordSchema,
  InstallTransactionSchema,
  type FoundationManifest,
  type InstallPlan,
  type InstallRecord,
  type InstallTransaction,
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

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isErrnoException(error) && error.code === "EPERM";
  }
}

function assertReplaceableLinkTarget(target: string): void {
  try {
    if (!lstatSync(target).isSymbolicLink()) {
      throw new Error(`refusing to replace a non-symlink target: ${target}`);
    }
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return;
    throw error;
  }
}

function unlinkIfPresent(target: string): void {
  try {
    unlinkSync(target);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return;
    throw error;
  }
}

function linkMatchesAllowedState(target: string, allowedTargets: Array<string | null>): boolean {
  try {
    if (!lstatSync(target).isSymbolicLink()) return false;
    const actual = linkTarget(target);
    return actual !== null && allowedTargets.includes(actual);
  } catch (error) {
    return isErrnoException(error) && error.code === "ENOENT" && allowedTargets.includes(null);
  }
}

function atomicSymlink(source: string, target: string): void {
  assertReplaceableLinkTarget(target);
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.tmp`);
  unlinkIfPresent(temporary);
  symlinkSync(source, temporary, process.platform === "win32" ? "junction" : undefined);
  renameSync(temporary, target);
}

function restoreLink(target: string, previousTarget: string | null): void {
  if (previousTarget === null) {
    unlinkIfPresent(target);
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

function createJsonFileAtomic(filePath: string, value: unknown, mode: number): void {
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.create`,
  );
  rmSync(temporary, { force: true });
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode });
    linkSync(temporary, filePath);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function prepareRelease(input: {
  distributionRoot: string;
  manifestPath: string;
  manifest: FoundationManifest;
  releasesRoot: string;
  releasePath: string;
  stagingPath: string | null;
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
  const stagingPath = input.stagingPath;
  if (!stagingPath) throw new Error("release staging path is required for a new release");
  assertOwnedTemporary(input.releasesRoot, stagingPath);
  rmSync(stagingPath, { recursive: true, force: true });
  try {
    cpSync(input.distributionRoot, stagingPath, { recursive: true });
    cpSync(input.manifestPath, path.join(stagingPath, ".foundation-manifest.json"));
    verifyDistribution(stagingPath, input.manifest);
    return true;
  } catch (error) {
    rmSync(stagingPath, { recursive: true, force: true });
    throw error;
  }
}

function prepareControlHome(
  templateRoot: string,
  controlHome: string,
  stagingPath: string | null,
): boolean {
  if (existsSync(controlHome)) return false;
  if (!stagingPath) throw new Error("Control Workspace staging path is required for a new home");
  if (!statSync(templateRoot).isDirectory()) {
    throw new Error(`Control Workspace template is not a directory: ${templateRoot}`);
  }
  mkdirSync(path.dirname(controlHome), { recursive: true, mode: 0o700 });
  assertOwnedTemporary(path.dirname(controlHome), stagingPath);
  rmSync(stagingPath, { recursive: true, force: true });
  try {
    cpSync(templateRoot, stagingPath, { recursive: true });
    return true;
  } catch (error) {
    rmSync(stagingPath, { recursive: true, force: true });
    throw error;
  }
}

function transactionStagingPaths(input: {
  install: ReturnType<typeof resolveInstallLayout>;
  planId: string;
  includeControlWorkspace: boolean;
}): { releaseStagingPath: string | null; controlStagingPath: string | null } {
  const suffix = `${process.pid}-${input.planId.slice(0, 12)}-staging`;
  return {
    releaseStagingPath: existsSync(input.install.releasePath)
      ? null
      : path.join(
          input.install.releasesRoot,
          `.${path.basename(input.install.releasePath)}-${suffix}`,
        ),
    controlStagingPath:
      !input.includeControlWorkspace || existsSync(input.install.controlHome)
        ? null
        : path.join(path.dirname(input.install.controlHome), `.paseo-control-${suffix}`),
  };
}

function directoryFingerprint(root: string): string {
  const entries: Array<{
    path: string;
    type: string;
    mode: number;
    sha256?: string;
    target?: string;
  }> = [];
  entries.push({ path: ".", type: "directory", mode: lstatSync(root).mode & 0o777 });
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute);
      const mode = lstatSync(absolute).mode & 0o777;
      if (entry.isDirectory()) {
        entries.push({ path: relative, type: "directory", mode });
        visit(absolute);
      } else if (entry.isFile()) {
        entries.push({ path: relative, type: "file", mode, sha256: sha256(absolute) });
      } else if (entry.isSymbolicLink()) {
        entries.push({ path: relative, type: "symlink", mode, target: readlinkSync(absolute) });
      } else {
        throw new Error(`unsupported Control Workspace template entry: ${absolute}`);
      }
    }
  };
  visit(root);
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

function validateTransactionOwnership(home: string, transaction: InstallTransaction): void {
  const resolvedHome = path.resolve(home);
  const install = resolveInstallLayout({
    home: resolvedHome,
    distributionVersion: path.basename(transaction.releasePath),
  });
  const transactionTargets = transaction.previousLinks.map(({ target }) => target);
  const skillNames = foundationSkillNamesFromTargets(resolvedHome, transactionTargets);
  const expectedTargets = legacyRoleLinks({
    home: resolvedHome,
    releasePath: transaction.releasePath,
    skillNames,
  }).map(({ target }) => target);
  const stagingSuffix = `${transaction.ownerPid}-${transaction.planId.slice(0, 12)}-staging`;
  const expectedReleaseStaging = path.join(
    install.releasesRoot,
    `.${path.basename(install.releasePath)}-${stagingSuffix}`,
  );
  const expectedControlStaging = path.join(
    path.dirname(install.controlHome),
    `.paseo-control-${stagingSuffix}`,
  );
  const releaseStagingValid =
    transaction.releaseStagingPath === null ||
    transaction.releaseStagingPath === expectedReleaseStaging;
  const controlStagingValid =
    transaction.controlStagingPath === null ||
    transaction.controlStagingPath === expectedControlStaging;
  if (
    transaction.home !== resolvedHome ||
    transaction.releasePath !== install.releasePath ||
    transaction.currentLink !== install.currentLink ||
    transaction.controlHome !== install.controlHome ||
    transaction.installRecordPath !== install.installRecordPath ||
    JSON.stringify(transactionTargets) !== JSON.stringify(expectedTargets) ||
    !releaseStagingValid ||
    !controlStagingValid
  ) {
    throw new Error("install transaction contains paths outside the canonical Foundation layout");
  }
}

function readInstallTransaction(home: string): {
  transaction: InstallTransaction;
  transactionPath: string;
} | null {
  const install = resolveInstallLayout({ home, distributionVersion: "unknown" });
  if (!existsSync(install.transactionPath)) return null;
  const parsed: unknown = JSON.parse(readFileSync(install.transactionPath, "utf8"));
  const transaction = InstallTransactionSchema.parse(parsed);
  validateTransactionOwnership(install.home, transaction);
  return { transaction, transactionPath: install.transactionPath };
}

function restoreInstallRecord(transaction: InstallTransaction): void {
  if (transaction.previousInstallRecordBase64 === null) {
    rmSync(transaction.installRecordPath, { force: true });
    return;
  }
  mkdirSync(path.dirname(transaction.installRecordPath), { recursive: true, mode: 0o700 });
  const bytes = Buffer.from(transaction.previousInstallRecordBase64, "base64");
  writeFileSync(transaction.installRecordPath, bytes, { mode: 0o600 });
}

export function recoverInterruptedInstall(home: string): boolean {
  const interrupted = readInstallTransaction(home);
  if (!interrupted) return false;
  const { transaction, transactionPath } = interrupted;
  if (transaction.ownerPid !== process.pid && isProcessRunning(transaction.ownerPid)) {
    throw new Error(`install transaction owner PID ${transaction.ownerPid} is still running`);
  }
  // Validate every final path before restoring any link so a failed recovery is no-write.
  const skillNames = foundationSkillNamesFromTargets(
    transaction.home,
    transaction.previousLinks.map(({ target }) => target),
  );
  const activeLinks = legacyRoleLinks({
    home: transaction.home,
    releasePath: transaction.releasePath,
    skillNames,
  });
  for (const [index, previous] of transaction.previousLinks.entries()) {
    if (
      !linkMatchesAllowedState(previous.target, [
        previous.previousTarget,
        null,
        activeLinks[index]?.source ?? null,
      ])
    ) {
      throw new Error(`refusing recovery because a runtime target changed: ${previous.target}`);
    }
  }
  if (
    !linkMatchesAllowedState(transaction.currentLink, [
      transaction.previousCurrentTarget,
      transaction.releasePath,
    ])
  ) {
    throw new Error(
      `refusing recovery because the current release target changed: ${transaction.currentLink}`,
    );
  }
  if (transaction.controlStagingPath) {
    if (existsSync(transaction.controlHome)) {
      if (
        transaction.controlTemplateFingerprint === null ||
        directoryFingerprint(transaction.controlHome) !== transaction.controlTemplateFingerprint
      ) {
        throw new Error("refusing to remove a changed Control Workspace during recovery");
      }
    }
  }
  if (transaction.releaseStagingPath) {
    if (existsSync(transaction.releasePath)) {
      const manifest = readManifest(
        path.join(transaction.releasePath, ".foundation-manifest.json"),
      );
      verifyDistribution(transaction.releasePath, manifest);
    }
  }
  for (const previous of transaction.previousLinks.toReversed()) {
    restoreLink(previous.target, previous.previousTarget);
  }
  restoreLink(transaction.currentLink, transaction.previousCurrentTarget);
  if (transaction.controlStagingPath) {
    rmSync(transaction.controlStagingPath, { recursive: true, force: true });
    rmSync(transaction.controlHome, { recursive: true, force: true });
  }
  if (transaction.releaseStagingPath) {
    rmSync(transaction.releaseStagingPath, { recursive: true, force: true });
    rmSync(transaction.releasePath, { recursive: true, force: true });
  }
  restoreInstallRecord(transaction);
  rmSync(transactionPath, { force: true });
  return true;
}

function prepareInstallApplication(planInput: InstallPlan) {
  const plan = InstallPlanSchema.parse(planInput);
  verifyPlanIdentity(plan);
  if (!["darwin", "linux", "win32"].includes(process.platform)) {
    throw new Error(`unsupported operating system: ${process.platform}`);
  }
  recoverInterruptedInstall(plan.home);
  const inspection = inspectMachine({ home: plan.home, productRoot: plan.productRoot });
  const canonicalPlan = createInstallPlanFromInspection(
    plan.mode,
    inspection,
    plan.includeControlWorkspace,
  );
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
  const staging = transactionStagingPaths({
    install,
    planId: plan.planId,
    includeControlWorkspace: plan.includeControlWorkspace,
  });
  const transaction = InstallTransactionSchema.parse({
    schemaVersion: 1,
    operation: "install",
    ownerPid: process.pid,
    planId: plan.planId,
    home: install.home,
    releasePath: install.releasePath,
    releaseStagingPath: staging.releaseStagingPath,
    controlHome: install.controlHome,
    controlStagingPath: staging.controlStagingPath,
    controlTemplateFingerprint: staging.controlStagingPath
      ? directoryFingerprint(product.controlTemplateRoot)
      : null,
    currentLink: install.currentLink,
    previousCurrentTarget,
    previousLinks: priorLinkTargets,
    installRecordPath: install.installRecordPath,
    previousInstallRecordBase64: priorRecordBytes?.toString("base64") ?? null,
    createdAt: new Date().toISOString(),
  });
  return {
    inspection,
    product,
    manifest,
    install,
    previousCurrentTarget,
    priorLinkTargets,
    staging,
    transaction,
  };
}

export function applyInstallPlan(plan: InstallPlan): AppliedInstall {
  const {
    inspection,
    product,
    manifest,
    install,
    previousCurrentTarget,
    priorLinkTargets,
    staging,
    transaction,
  } = prepareInstallApplication(plan);

  try {
    createJsonFileAtomic(install.transactionPath, transaction, 0o600);
    const createdRelease = prepareRelease({
      distributionRoot: product.distributionRoot,
      manifestPath: product.manifestPath,
      manifest,
      releasesRoot: install.releasesRoot,
      releasePath: install.releasePath,
      stagingPath: staging.releaseStagingPath,
    });
    const createdControlHome = plan.includeControlWorkspace
      ? prepareControlHome(
          product.controlTemplateRoot,
          install.controlHome,
          staging.controlStagingPath,
        )
      : false;
    if (staging.releaseStagingPath) renameSync(staging.releaseStagingPath, install.releasePath);
    if (staging.controlStagingPath) renameSync(staging.controlStagingPath, install.controlHome);
    atomicSymlink(install.releasePath, install.currentLink);
    for (const link of plan.links) {
      if (!linkMatchesAllowedState(link.target, [link.previousTarget])) {
        throw new Error(`refusing to retire a changed legacy runtime link: ${link.target}`);
      }
      unlinkIfPresent(link.target);
    }

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
      controlHome: plan.includeControlWorkspace ? install.controlHome : null,
      installedLinks: [],
      previousReleasePath:
        previousReleasePath && previousReleasePath !== install.releasePath
          ? previousReleasePath
          : null,
      previousCurrentTarget,
      previousLinks: priorLinkTargets,
      legacyRecordPath: inspection.legacyInstallRecordPresent ? install.legacyRecordPath : null,
    });
    writeJsonAtomic(install.installRecordPath, record, 0o600);
    rmSync(install.transactionPath, { force: true });
    return { record, createdRelease, createdControlHome };
  } catch (error) {
    try {
      recoverInterruptedInstall(install.home);
    } catch (recoveryError) {
      const installFailure = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Foundation install failed and automatic recovery did not complete; install error: ${installFailure}`,
        { cause: recoveryError },
      );
    }
    throw error;
  }
}

function validateRecordOwnership(home: string, record: InstallRecord): void {
  const install = resolveInstallLayout({ home, distributionVersion: record.distributionVersion });
  const recordLinks = record.installedLinks.map(({ source, target }) => ({ source, target }));
  const previousTargets = record.previousLinks?.map(({ target }) => target);
  const ownershipTargets =
    recordLinks.length > 0 ? recordLinks.map(({ target }) => target) : (previousTargets ?? []);
  const skillNames = foundationSkillNamesFromTargets(install.home, ownershipTargets);
  const expectedLinks = legacyRoleLinks({
    home: install.home,
    releasePath: install.releasePath,
    skillNames,
  });
  const expectedTargets = expectedLinks.map(({ target }) => target);
  let linkLayoutValid: boolean;
  if (record.mode === "migration" && recordLinks.length === 0 && previousTargets === undefined) {
    linkLayoutValid = true;
  } else if (recordLinks.length === 0) {
    linkLayoutValid =
      previousTargets !== undefined &&
      JSON.stringify(previousTargets) === JSON.stringify(expectedTargets);
  } else {
    linkLayoutValid =
      JSON.stringify(recordLinks) === JSON.stringify(expectedLinks) &&
      (previousTargets === undefined ||
        JSON.stringify(previousTargets) === JSON.stringify(expectedTargets));
  }
  if (
    record.releasePath !== install.releasePath ||
    record.currentLink !== install.currentLink ||
    (record.controlHome !== null && record.controlHome !== install.controlHome) ||
    !linkLayoutValid ||
    (record.previousReleasePath !== null &&
      releaseWithin(install.releasesRoot, record.previousReleasePath) === null) ||
    (record.legacyRecordPath !== null && record.legacyRecordPath !== install.legacyRecordPath)
  ) {
    throw new Error("install record contains paths outside the canonical Foundation layout");
  }
}

function readActiveRecord(home: string): { record: InstallRecord; recordPath: string } {
  recoverInterruptedInstall(home);
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
    if (
      record.mode !== "migration" ||
      record.previousLinks === undefined ||
      record.previousCurrentTarget === undefined
    ) {
      throw new Error("no previous Foundation release is available for rollback");
    }
    const priorCurrentTarget = linkTarget(record.currentLink);
    const priorLinkTargets = record.installedLinks.map((link) => ({
      target: link.target,
      previousTarget: linkTarget(link.target),
    }));
    for (const [index, link] of record.installedLinks.entries()) {
      if (priorLinkTargets[index]?.previousTarget !== link.source) {
        throw new Error(`refusing rollback because an owned runtime link changed: ${link.target}`);
      }
    }
    if (priorCurrentTarget !== record.releasePath) {
      throw new Error(
        `refusing rollback because the current release link changed: ${record.currentLink}`,
      );
    }
    try {
      for (const previous of record.previousLinks.toReversed()) {
        restoreLink(previous.target, previous.previousTarget);
      }
      restoreLink(record.currentLink, record.previousCurrentTarget);
      const rolledBack = InstallRecordSchema.parse({
        ...record,
        status: "uninstalled",
        rolledBackAt: new Date().toISOString(),
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
  const previousManifest = readManifest(
    path.join(previousReleasePath, ".foundation-manifest.json"),
  );
  verifyDistribution(previousReleasePath, previousManifest);
  const previousSnapshots = record.previousLinks ?? [];
  const previousLinks = previousSnapshots.flatMap((link) =>
    link.previousTarget === null ? [] : [{ target: link.target, source: link.previousTarget }],
  );
  const priorCurrentTarget = linkTarget(record.currentLink);
  const priorLinkTargets = previousSnapshots.map((link) => ({
    target: link.target,
    previousTarget: linkTarget(link.target),
  }));
  for (const link of priorLinkTargets) {
    if (link.previousTarget !== null) {
      throw new Error(`refusing rollback because a retired runtime target changed: ${link.target}`);
    }
  }
  if (priorCurrentTarget !== record.releasePath) {
    throw new Error(
      `refusing rollback because the current release link changed: ${record.currentLink}`,
    );
  }
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
      previousCurrentTarget: priorCurrentTarget,
      previousLinks: priorLinkTargets,
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
  if (
    record.mode === "migration" &&
    (record.previousLinks === undefined || record.previousCurrentTarget === undefined)
  ) {
    throw new Error(
      "refusing uninstall because the migration install record lacks an exact previous-link snapshot",
    );
  }
  const priorCurrentTarget = linkTarget(record.currentLink);
  const priorLinkTargets = record.installedLinks.map((link) => ({
    target: link.target,
    previousTarget: linkTarget(link.target),
  }));
  try {
    for (const [index, link] of record.installedLinks.entries()) {
      if (linkTarget(link.target) === link.source) {
        restoreLink(link.target, record.previousLinks?.[index]?.previousTarget ?? null);
      }
    }
    if (linkTarget(record.currentLink) === record.releasePath) {
      restoreLink(record.currentLink, record.previousCurrentTarget ?? null);
    }
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
