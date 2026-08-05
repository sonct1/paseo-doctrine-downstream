import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { inspectMachine, type MachineInspection } from "./inspection.js";
import { resolveInstallLayout } from "./layout.js";
import {
  InstallModeSchema,
  InstallPlanSchema,
  type InstallMode,
  type InstallPlan,
  type PathState,
} from "./schema.js";

function allowedState(mode: InstallMode, state: PathState): boolean {
  if (state === "absent" || state === "owned-current") return true;
  if (mode === "migration") return state === "owned-stale" || state === "legacy-owned";
  if (mode === "update") return state === "owned-stale";
  return false;
}

function planDigest(plan: Omit<InstallPlan, "planId">): string {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

function blockersFor(input: { inspection: MachineInspection; mode: InstallMode }): string[] {
  const blockers: string[] = [];
  if (input.inspection.platform !== "darwin") {
    blockers.push(`macOS is required; detected ${input.inspection.platform}`);
  }
  for (const link of [...input.inspection.links, input.inspection.currentLink]) {
    if (!allowedState(input.mode, link.state)) {
      blockers.push(`${link.target} is ${link.state}`);
    }
  }
  if (input.mode === "clean-empty") {
    if (input.inspection.installRecord)
      blockers.push("an existing Foundation install record is present");
    if (input.inspection.legacyInstallRecordPresent) {
      blockers.push("a legacy Paseo Foundation install record requires migration mode");
    }
    if (input.inspection.controlHomePresent)
      blockers.push("the Control Workspace Home already exists");
    if (input.inspection.releasePresent)
      blockers.push("the target Foundation release already exists");
  }
  if (input.mode === "coexist" && input.inspection.installRecord?.status === "active") {
    blockers.push("an active Foundation installation requires update mode");
  }
  if (input.mode === "update" && input.inspection.installRecord?.status !== "active") {
    blockers.push("update mode requires an active Foundation install record");
  }
  return blockers.sort();
}

export function createInstallPlan(input: {
  mode: InstallMode;
  home?: string;
  productRoot?: string;
  environmentPath?: string;
  platform?: string;
  architecture?: string;
}): InstallPlan {
  const mode = InstallModeSchema.parse(input.mode);
  const inspection = inspectMachine(input);
  return createInstallPlanFromInspection(mode, inspection);
}

export function createInstallPlanFromInspection(
  modeInput: InstallMode,
  inspection: MachineInspection,
): InstallPlan {
  const mode = InstallModeSchema.parse(modeInput);
  const install = resolveInstallLayout({
    home: inspection.home,
    distributionVersion: inspection.distributionVersion,
  });
  const planWithoutId: Omit<InstallPlan, "planId"> = {
    schemaVersion: 1,
    mode,
    home: inspection.home,
    productRoot: inspection.productRoot,
    distributionVersion: inspection.distributionVersion,
    foundationCommit: inspection.foundationCommit,
    releasePath: install.releasePath,
    currentLink: install.currentLink,
    controlHome: install.controlHome,
    inspectionFingerprint: inspection.mutationFingerprint,
    links: inspection.links.map(({ source, target, state, previousTarget }) => ({
      source,
      target,
      state,
      previousTarget,
    })),
    blockers: blockersFor({ inspection, mode }),
  };
  return InstallPlanSchema.parse({ ...planWithoutId, planId: planDigest(planWithoutId) });
}

export function verifyPlanIdentity(plan: InstallPlan): void {
  const { planId, ...planWithoutId } = plan;
  const expected = planDigest(planWithoutId);
  if (expected !== planId) throw new Error(`install plan identity mismatch: expected ${expected}`);
}

export function readInstallPlan(filePath: string): InstallPlan {
  const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
  const plan = InstallPlanSchema.parse(parsed);
  verifyPlanIdentity(plan);
  return plan;
}

export function writeInstallPlan(filePath: string, plan: InstallPlan): void {
  const resolved = path.resolve(filePath);
  mkdirSync(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, resolved);
}
