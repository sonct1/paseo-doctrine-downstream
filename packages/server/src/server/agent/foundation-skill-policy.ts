import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { PaseoRoleId } from "@getpaseo/protocol/role-binding";
import type { FoundationExecutionProfileId } from "./foundation-execution-profiles.js";

const KNOWN_FOUNDATION_SKILLS = [
  "architecture-premise-audit",
  "frontend-design",
  "paseo-supervisor",
  "repo-refresh",
  "test-proof-debt-audit",
  "triple-review",
  // Legacy package name from already-imported immutable Foundation releases.
  "ultra-review",
] as const;

interface RoleBundleRecord {
  active: string[];
  explicitOnly: string[];
  packagedDisabled: string[];
}

interface RoleBundleManifest {
  schemaVersion: number;
  packages: Record<string, unknown>;
  roles: Record<PaseoRoleId, RoleBundleRecord>;
}

export interface FoundationSkillPolicy {
  packageNames: ReadonlySet<string>;
  enabledNames: ReadonlySet<string>;
  manifestPath: string;
  status: "bound" | "missing-or-invalid";
}

function defaultManifestPath(): string {
  const releaseRoot =
    process.env.PASEO_FOUNDATION_CURRENT ??
    path.join(os.homedir(), ".local", "share", "paseo-foundation", "current");
  return path.join(releaseRoot, "skills", "role-bundles.json");
}

function stringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.length > 0)
  );
}

function parseManifest(filePath: string): RoleBundleManifest | null {
  try {
    const value: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    if (!value || typeof value !== "object") return null;
    const record = value as Partial<RoleBundleManifest>;
    if (record.schemaVersion !== 1 || !record.packages || !record.roles) return null;
    for (const role of ["lead", "peer", "supervisor"] as const) {
      const bundle = record.roles[role];
      if (
        !bundle ||
        !stringArray(bundle.active) ||
        !stringArray(bundle.explicitOnly) ||
        !stringArray(bundle.packagedDisabled)
      ) {
        return null;
      }
    }
    return record as RoleBundleManifest;
  } catch {
    return null;
  }
}

export function loadFoundationSkillPolicy(
  roleId: PaseoRoleId,
  manifestPath = defaultManifestPath(),
  executionProfileId?: FoundationExecutionProfileId,
): FoundationSkillPolicy {
  const manifest = existsSync(manifestPath) ? parseManifest(manifestPath) : null;
  if (!manifest) {
    return {
      packageNames: new Set(KNOWN_FOUNDATION_SKILLS),
      enabledNames: new Set(),
      manifestPath,
      status: "missing-or-invalid",
    };
  }

  const packageNames = new Set(Object.keys(manifest.packages));
  const bundle = manifest.roles[roleId];
  const enabledNames =
    executionProfileId === "review"
      ? new Set<string>()
      : new Set([...bundle.active, ...bundle.explicitOnly]);
  if ([...enabledNames].some((name) => !packageNames.has(name))) {
    return {
      packageNames: new Set([...KNOWN_FOUNDATION_SKILLS, ...packageNames]),
      enabledNames: new Set(),
      manifestPath,
      status: "missing-or-invalid",
    };
  }
  return { packageNames, enabledNames, manifestPath, status: "bound" };
}

function codexSkillName(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const skillPath = (value as { path?: unknown }).path;
  if (typeof skillPath !== "string") return null;
  const normalized = skillPath.replaceAll("\\", "/");
  const match = normalized.match(/\/skills\/([a-z0-9-]+)\/SKILL\.md$/u);
  return match?.[1] ?? null;
}

export function mergeCodexFoundationSkillConfig(
  existing: unknown,
  policy: FoundationSkillPolicy,
  codexHome: string,
): Array<{ path: string; enabled: boolean } | unknown> {
  const retained = Array.isArray(existing)
    ? existing.filter((entry) => {
        const name = codexSkillName(entry);
        return name === null || !policy.packageNames.has(name);
      })
    : [];
  const projected = [...policy.packageNames].sort().map((name) => ({
    path: path.join(codexHome, "skills", name, "SKILL.md"),
    enabled: policy.enabledNames.has(name),
  }));
  return [...retained, ...projected];
}

export function filterFoundationSkills<T extends { name: string }>(
  skills: T[],
  policy: FoundationSkillPolicy | null | undefined,
): T[] {
  if (!policy) return skills;
  return skills.filter(
    (skill) => !policy.packageNames.has(skill.name) || policy.enabledNames.has(skill.name),
  );
}
