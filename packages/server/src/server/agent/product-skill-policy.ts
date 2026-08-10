import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { PaseoRoleId } from "@getpaseo/protocol/role-binding";

const KNOWN_PRODUCT_ROLE_SKILLS = ["council", "beads-issue-tracker"] as const;

interface RoleAdmissionRecord {
  active: string[];
  explicitOnly: string[];
  packagedDisabled: string[];
}

interface ProductRoleAdmissionManifest {
  schemaVersion: number;
  packages: Record<string, unknown>;
  roles: Record<PaseoRoleId, RoleAdmissionRecord>;
}

export interface ProductSkillPolicy {
  packageNames: ReadonlySet<string>;
  enabledNames: ReadonlySet<string>;
  skillPaths: ReadonlyMap<string, string>;
  bundleRoot: string;
  manifestPath: string;
  status: "bound" | "missing-or-invalid";
}

function stringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "string" && /^[a-z0-9-]+$/u.test(entry))
  );
}

function defaultBundleRoot(): string {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const bundled = path.join(moduleDirectory, "product-skills");
  if (existsSync(path.join(bundled, "role-admission.json"))) return bundled;

  // Source-tree fallback for tests and `tsx` development. Production builds always
  // resolve the adjacent immutable bundle above, independent of workspace cwd.
  return path.resolve(moduleDirectory, "../../../../../skills");
}

function parseManifest(filePath: string, bundleRoot: string): ProductRoleAdmissionManifest | null {
  try {
    const value: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    if (!value || typeof value !== "object") return null;
    const record = value as Partial<ProductRoleAdmissionManifest>;
    if (record.schemaVersion !== 1 || !record.packages || !record.roles) return null;

    const packageNames = Object.keys(record.packages);
    if (
      packageNames.length === 0 ||
      packageNames.some((name) => !/^[a-z0-9-]+$/u.test(name)) ||
      packageNames.some((name) => !existsSync(path.join(bundleRoot, name, "SKILL.md")))
    ) {
      return null;
    }

    const packageSet = new Set(packageNames);
    for (const role of ["lead", "peer", "supervisor"] as const) {
      const admission = record.roles[role];
      if (
        !admission ||
        !stringArray(admission.active) ||
        !stringArray(admission.explicitOnly) ||
        !stringArray(admission.packagedDisabled)
      ) {
        return null;
      }
      const states = [
        ...admission.active,
        ...admission.explicitOnly,
        ...admission.packagedDisabled,
      ];
      if (
        states.length !== packageNames.length ||
        new Set(states).size !== states.length ||
        states.some((name) => !packageSet.has(name))
      ) {
        return null;
      }
    }
    return record as ProductRoleAdmissionManifest;
  } catch {
    return null;
  }
}

function failedPolicy(bundleRoot: string, manifestPath: string): ProductSkillPolicy {
  return {
    packageNames: new Set(KNOWN_PRODUCT_ROLE_SKILLS),
    enabledNames: new Set(),
    skillPaths: new Map(
      KNOWN_PRODUCT_ROLE_SKILLS.map((name) => [name, path.join(bundleRoot, name, "SKILL.md")]),
    ),
    bundleRoot,
    manifestPath,
    status: "missing-or-invalid",
  };
}

export function loadProductSkillPolicy(
  roleId: PaseoRoleId,
  bundleRoot = defaultBundleRoot(),
): ProductSkillPolicy {
  const manifestPath = path.join(bundleRoot, "role-admission.json");
  const manifest = existsSync(manifestPath) ? parseManifest(manifestPath, bundleRoot) : null;
  if (!manifest) return failedPolicy(bundleRoot, manifestPath);

  const packageNames = new Set(Object.keys(manifest.packages));
  const admission = manifest.roles[roleId];
  const enabledNames = new Set([...admission.active, ...admission.explicitOnly]);
  const skillPaths = new Map(
    [...packageNames].map((name) => [name, path.join(bundleRoot, name, "SKILL.md")]),
  );
  return {
    packageNames,
    enabledNames,
    skillPaths,
    bundleRoot,
    manifestPath,
    status: "bound",
  };
}

function configuredSkillName(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const skillPath = (value as { path?: unknown }).path;
  if (typeof skillPath !== "string") return null;
  const normalized = skillPath.replaceAll("\\", "/");
  const match = normalized.match(/\/([a-z0-9-]+)\/SKILL\.md$/u);
  return match?.[1] ?? null;
}

function configuredSkillPath(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const skillPath = (value as { path?: unknown }).path;
  return typeof skillPath === "string" ? skillPath : null;
}

export function mergeCodexProductSkillConfig(
  existing: unknown,
  policy: ProductSkillPolicy,
  codexHome: string,
): Array<{ path: string; enabled: boolean } | unknown> {
  const entries = Array.isArray(existing) ? existing : [];
  const retained = entries.filter((entry) => {
    const name = configuredSkillName(entry);
    return name === null || !policy.packageNames.has(name);
  });
  const configuredProductPaths = entries.flatMap((entry) => {
    const name = configuredSkillName(entry);
    const skillPath = configuredSkillPath(entry);
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

  for (const skillPath of configuredProductPaths) push(skillPath, false);
  for (const name of [...policy.packageNames].sort()) {
    push(path.join(codexHome, "skills", name, "SKILL.md"), false);
    const canonicalPath = policy.skillPaths.get(name);
    if (canonicalPath) {
      // Canonical projection is last so an owning Lead gets the immutable bundled
      // package while stale global or caller-supplied copies remain disabled.
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

function admittedName(name: string, packageNames: ReadonlySet<string>): string | null {
  if (packageNames.has(name)) return name;
  const namespaced = name.split(":").at(-1);
  return namespaced && packageNames.has(namespaced) ? namespaced : null;
}

export function filterProductSkills<T extends { name: string }>(
  skills: T[],
  policy: ProductSkillPolicy | null | undefined,
): T[] {
  if (!policy) return skills;
  return skills.filter((skill) => {
    const name = admittedName(skill.name, policy.packageNames);
    return name === null || (policy.status === "bound" && policy.enabledNames.has(name));
  });
}

export function mergeClaudeProductPlugins(
  existing: ReadonlyArray<{ type: "local"; path: string; skipMcpDiscovery?: boolean }> | undefined,
  policy: ProductSkillPolicy,
): Array<{ type: "local"; path: string; skipMcpDiscovery?: boolean }> {
  const retained = (existing ?? []).filter((plugin) => {
    const name = path.basename(plugin.path);
    return !policy.packageNames.has(name);
  });
  const projected = [...policy.enabledNames].sort().flatMap((name) => {
    const skillPath = policy.skillPaths.get(name);
    return skillPath
      ? [{ type: "local" as const, path: path.dirname(skillPath), skipMcpDiscovery: true as const }]
      : [];
  });
  return [...retained, ...projected];
}

export function claudeProductSkillDenyRules(policy: ProductSkillPolicy): string[] {
  return [...policy.packageNames]
    .filter((name) => policy.status !== "bound" || !policy.enabledNames.has(name))
    .sort()
    .flatMap((name) => [`Skill(${name})`, `Skill(${name}:${name})`]);
}
