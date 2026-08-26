import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PASEO_ROLE_IDS, type PaseoRoleId } from "@getpaseo/protocol/role-binding";

const KNOWN_FOUNDATION_SKILLS = [
  "architecture-premise-audit",
  "beads-issue-tracker",
  "frontend-design",
  "paseo-supervisor",
  "repo-refresh",
  "test-proof-debt-audit",
  "triple-review",
  // Retired package name kept here so missing/invalid manifests disable stale
  // user-global copies instead of leaking them into a role inventory.
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
  skillPaths: ReadonlyMap<string, string>;
  manifestPath: string;
  status: "bound" | "missing-or-invalid";
}

export interface FoundationSkillArtifactDescriptor {
  manifestDigest: string;
  packages: Array<{
    name: string;
    files: Array<{ path: string; digest: string }>;
  }>;
  roles: Record<PaseoRoleId, string[]>;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function packageFileDigests(
  packageRoot: string,
  current = packageRoot,
): Array<{
  path: string;
  digest: string;
}> {
  return readdirSync(current, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) return packageFileDigests(packageRoot, entryPath);
      if (!entry.isFile()) {
        throw new Error(`Unsupported SLP skill artifact entry: ${entryPath}`);
      }
      return [
        {
          path: path.relative(packageRoot, entryPath).replaceAll(path.sep, "/"),
          digest: sha256(readFileSync(entryPath)),
        },
      ];
    });
}

function defaultManifestPath(): string {
  const configuredReleaseRoot = process.env.PASEO_FOUNDATION_CURRENT;
  if (configuredReleaseRoot) {
    return path.join(configuredReleaseRoot, "skills", "role-bundles.json");
  }

  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const bundled = path.join(moduleDirectory, "skills", "role-bundles.json");
  if (existsSync(bundled)) return bundled;

  // Source-tree fallback for tests and `tsx` development. Production builds use
  // the adjacent immutable bundle above, not whichever Foundation release happens
  // to be installed on the host.
  const imported = path.resolve(
    moduleDirectory,
    "../../../../../../../foundation/dist/skills/role-bundles.json",
  );
  if (existsSync(imported)) return imported;

  return path.join(
    os.homedir(),
    ".local",
    "share",
    "paseo-foundation",
    "current",
    "skills",
    "role-bundles.json",
  );
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
    const packageNames = Object.keys(record.packages);
    const packageSet = new Set(packageNames);
    const skillRoot = path.dirname(filePath);
    if (
      packageNames.length === 0 ||
      packageNames.some((name) => !/^[a-z0-9-]+$/u.test(name)) ||
      packageNames.some((name) => !existsSync(path.join(skillRoot, name, "SKILL.md")))
    ) {
      return null;
    }
    for (const role of ["lead", "peer", "supervisor"] as const) {
      const bundle = record.roles[role];
      if (
        !bundle ||
        !stringArray(bundle.active) ||
        !stringArray(bundle.explicitOnly) ||
        !stringArray(bundle.packagedDisabled) ||
        [...bundle.active, ...bundle.explicitOnly, ...bundle.packagedDisabled].some(
          (name) => !packageSet.has(name),
        )
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
): FoundationSkillPolicy {
  const manifest = existsSync(manifestPath) ? parseManifest(manifestPath) : null;
  if (!manifest) {
    return {
      packageNames: new Set(KNOWN_FOUNDATION_SKILLS),
      enabledNames: new Set(),
      skillPaths: new Map(
        KNOWN_FOUNDATION_SKILLS.map((name) => [
          name,
          path.join(path.dirname(manifestPath), name, "SKILL.md"),
        ]),
      ),
      manifestPath,
      status: "missing-or-invalid",
    };
  }

  const packageNames = new Set(Object.keys(manifest.packages));
  const bundle = manifest.roles[roleId];
  const enabledNames = new Set([...bundle.active, ...bundle.explicitOnly]);
  if ([...enabledNames].some((name) => !packageNames.has(name))) {
    return {
      packageNames: new Set([...KNOWN_FOUNDATION_SKILLS, ...packageNames]),
      enabledNames: new Set(),
      skillPaths: new Map(
        [...KNOWN_FOUNDATION_SKILLS, ...packageNames].map((name) => [
          name,
          path.join(path.dirname(manifestPath), name, "SKILL.md"),
        ]),
      ),
      manifestPath,
      status: "missing-or-invalid",
    };
  }
  const skillPaths = new Map(
    [...packageNames].map((name) => [
      name,
      path.join(path.dirname(manifestPath), name, "SKILL.md"),
    ]),
  );
  return { packageNames, enabledNames, skillPaths, manifestPath, status: "bound" };
}

/** Exact bundled skill bytes and role admission used in the SLP generation digest. */
export function buildFoundationSkillArtifactDescriptor(
  requestedManifestPath?: string,
): FoundationSkillArtifactDescriptor {
  const policies = Object.fromEntries(
    PASEO_ROLE_IDS.map((roleId) => [
      roleId,
      loadFoundationSkillPolicy(roleId, requestedManifestPath ?? defaultManifestPath()),
    ]),
  ) as Record<PaseoRoleId, FoundationSkillPolicy>;
  const manifestPath = policies.lead.manifestPath;
  for (const roleId of PASEO_ROLE_IDS) {
    const policy = policies[roleId];
    if (policy.status !== "bound" || policy.manifestPath !== manifestPath) {
      throw new Error(
        `foundation_skill_admission_required: role bundle is ${policy.status} at ${policy.manifestPath}`,
      );
    }
  }
  const packageNames = [...policies.lead.packageNames].sort();
  return {
    manifestDigest: sha256(readFileSync(manifestPath)),
    packages: packageNames.map((name) => ({
      name,
      files: packageFileDigests(path.join(path.dirname(manifestPath), name)),
    })),
    roles: Object.fromEntries(
      PASEO_ROLE_IDS.map((roleId) => [roleId, [...policies[roleId].enabledNames].sort()]),
    ) as Record<PaseoRoleId, string[]>,
  };
}

export function narrowFoundationSkillPolicy(
  policy: FoundationSkillPolicy,
  allowedNames: readonly string[] | undefined,
): FoundationSkillPolicy {
  if (!allowedNames) return policy;
  const allowed = new Set(allowedNames);
  return {
    ...policy,
    enabledNames: new Set([...policy.enabledNames].filter((name) => allowed.has(name))),
  };
}

function codexSkillName(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const skillPath = (value as { path?: unknown }).path;
  if (typeof skillPath !== "string") return null;
  const normalized = skillPath.replaceAll("\\", "/");
  const match = normalized.match(/\/skills\/([a-z0-9-]+)\/SKILL\.md$/u);
  return match?.[1] ?? null;
}

function codexSkillPath(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const skillPath = (value as { path?: unknown }).path;
  return typeof skillPath === "string" ? skillPath : null;
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
  const configuredFoundationPaths = (Array.isArray(existing) ? existing : []).flatMap((entry) => {
    const name = codexSkillName(entry);
    const skillPath = codexSkillPath(entry);
    return name && skillPath && policy.packageNames.has(name) ? [skillPath] : [];
  });
  const projected: Array<{ path: string; enabled: boolean }> = [];
  const emittedPaths = new Set<string>();
  const push = (skillPath: string, enabled: boolean): void => {
    const key = path.resolve(skillPath);
    if (emittedPaths.has(key)) return;
    emittedPaths.add(key);
    projected.push({ path: skillPath, enabled });
  };
  for (const skillPath of configuredFoundationPaths) push(skillPath, false);
  for (const name of [...policy.packageNames].sort()) {
    push(path.join(codexHome, "skills", name, "SKILL.md"), false);
    const canonicalPath = policy.skillPaths.get(name);
    if (canonicalPath) {
      emittedPaths.delete(path.resolve(canonicalPath));
      const priorIndex = projected.findIndex(
        (entry) => path.resolve(entry.path) === path.resolve(canonicalPath),
      );
      if (priorIndex >= 0) projected.splice(priorIndex, 1);
      push(canonicalPath, policy.status === "bound" && policy.enabledNames.has(name));
    }
  }
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

const CLAUDE_MANDATORY_FOUNDATION_SKILLS = ["beads-issue-tracker"] as const;

export function mergeClaudeMandatoryFoundationPlugins(
  existing: ReadonlyArray<{ type: "local"; path: string; skipMcpDiscovery?: boolean }> | undefined,
  policy: FoundationSkillPolicy,
): Array<{ type: "local"; path: string; skipMcpDiscovery?: boolean }> {
  const mandatoryNames = new Set<string>(CLAUDE_MANDATORY_FOUNDATION_SKILLS);
  const retained = (existing ?? []).filter(
    (plugin) => !mandatoryNames.has(path.basename(plugin.path)),
  );
  const projected = CLAUDE_MANDATORY_FOUNDATION_SKILLS.flatMap((name) => {
    const skillPath = policy.skillPaths.get(name);
    return policy.status === "bound" && policy.enabledNames.has(name) && skillPath
      ? [{ type: "local" as const, path: path.dirname(skillPath), skipMcpDiscovery: true as const }]
      : [];
  });
  return [...retained, ...projected];
}

export function claudeMandatoryFoundationSkillDenyRules(policy: FoundationSkillPolicy): string[] {
  return CLAUDE_MANDATORY_FOUNDATION_SKILLS.filter(
    (name) => policy.status !== "bound" || !policy.enabledNames.has(name),
  ).flatMap((name) => [`Skill(${name})`, `Skill(${name}:${name})`]);
}
