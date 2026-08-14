import { existsSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ProductLayout {
  productRoot: string;
  foundationRoot: string;
  distributionRoot: string;
  manifestPath: string;
  controlTemplateRoot: string;
}

export interface InstallLayout {
  home: string;
  shareRoot: string;
  releasesRoot: string;
  releasePath: string;
  currentLink: string;
  stateRoot: string;
  installRecordPath: string;
  transactionPath: string;
  controlHome: string;
  legacyRecordPath: string;
}

export const FOUNDATION_SKILL_NAMES = [
  "architecture-premise-audit",
  "beads-issue-tracker",
  "frontend-design",
  "paseo-supervisor",
  "repo-refresh",
  "test-proof-debt-audit",
  "triple-review",
  // Retained for migration/uninstall compatibility with older distributions.
  "ultra-review",
] as const;

function skillNamesAt(root: string): string[] {
  const skillsRoot = path.join(root, "skills");
  if (!existsSync(skillsRoot)) return [];
  const allowed = new Set<string>(FOUNDATION_SKILL_NAMES);
  const names = readdirSync(skillsRoot, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && existsSync(path.join(skillsRoot, entry.name, "SKILL.md")),
    )
    .map((entry) => entry.name)
    .sort();
  for (const name of names) {
    if (!allowed.has(name)) throw new Error(`unexpected Foundation skill package: ${name}`);
  }
  return names;
}

export function foundationSkillNamesFromTargets(home: string, targets: string[]): string[] {
  const skillsRoot = path.join(path.resolve(home), ".codex", "skills");
  const allowed = new Set<string>(FOUNDATION_SKILL_NAMES);
  const names = targets
    .filter((target) => path.dirname(target) === skillsRoot)
    .map((target) => path.basename(target));
  if (new Set(names).size !== names.length) {
    throw new Error("Foundation role links contain duplicate skill targets");
  }
  for (const name of names) {
    if (!allowed.has(name)) throw new Error(`unexpected Foundation skill target: ${name}`);
  }
  return names.sort();
}

function isProductRoot(candidate: string): boolean {
  const manifest = path.join(candidate, "foundation", "manifest.json");
  const controlTemplate = path.join(candidate, "control-workspace", "template");
  return existsSync(manifest) && existsSync(controlTemplate);
}

export function resolveProductLayout(explicitRoot?: string): ProductLayout {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = explicitRoot
    ? [path.resolve(explicitRoot)]
    : [path.resolve(moduleDirectory, "../../.."), path.resolve(moduleDirectory, "../assets")];
  const productRoot = candidates.find(isProductRoot);
  if (!productRoot) {
    throw new Error(`Paseo Foundation product assets were not found in: ${candidates.join(", ")}`);
  }
  const resolvedRoot = realpathSync(productRoot);
  return {
    productRoot: resolvedRoot,
    foundationRoot: path.join(resolvedRoot, "foundation"),
    distributionRoot: path.join(resolvedRoot, "foundation", "dist"),
    manifestPath: path.join(resolvedRoot, "foundation", "manifest.json"),
    controlTemplateRoot: path.join(resolvedRoot, "control-workspace", "template"),
  };
}

export function resolveInstallLayout(input: {
  home: string;
  distributionVersion: string;
}): InstallLayout {
  const home = path.resolve(input.home);
  const shareRoot = path.join(home, ".local", "share", "paseo-foundation");
  const releasesRoot = path.join(shareRoot, "releases");
  return {
    home,
    shareRoot,
    releasesRoot,
    releasePath: path.join(releasesRoot, input.distributionVersion),
    currentLink: path.join(shareRoot, "current"),
    stateRoot: path.join(home, ".paseo-foundation"),
    installRecordPath: path.join(home, ".paseo-foundation", "install.json"),
    transactionPath: path.join(home, ".paseo-foundation", "install-transaction.json"),
    controlHome: path.join(home, ".paseo-control"),
    legacyRecordPath: path.join(home, ".paseo", "paseo-workflow-pilot.json"),
  };
}

// COMPAT(legacyRoleLinks): detection/removal only. Delete this inventory after 2026-09-30
// once supported installs have crossed the native role-binding migration window.
export const LEGACY_ROLE_LINK_MIGRATION_EXPIRES_AT = "2026-09-30";

export function legacyRoleLinks(input: {
  home: string;
  releasePath: string;
  skillInventoryRoot?: string;
  skillNames?: string[];
}): Array<{ source: string; target: string }> {
  const codexRoot = path.join(input.home, ".codex");
  const paseoBin = path.join(input.home, ".paseo", "bin");
  const skillNames =
    input.skillNames ?? skillNamesAt(input.skillInventoryRoot ?? input.releasePath);
  const skillLinks = skillNames.map((name) => ({
    source: path.join(input.releasePath, "skills", name),
    target: path.join(codexRoot, "skills", name),
  }));
  return [
    {
      source: path.join(input.releasePath, "profiles", "codex", "lead.config.toml"),
      target: path.join(codexRoot, "lead.config.toml"),
    },
    {
      source: path.join(input.releasePath, "profiles", "codex", "peer.config.toml"),
      target: path.join(codexRoot, "peer.config.toml"),
    },
    {
      source: path.join(input.releasePath, "profiles", "codex", "supervisor.config.toml"),
      target: path.join(codexRoot, "supervisor.config.toml"),
    },
    ...skillLinks,
    {
      source: path.join(input.releasePath, "scripts", "codex-profile"),
      target: path.join(paseoBin, "codex-profile"),
    },
    {
      source: path.join(input.releasePath, "scripts", "codex-profile.py"),
      target: path.join(paseoBin, "codex-profile.py"),
    },
    {
      source: path.join(input.releasePath, "scripts", "codex-cliproxy-profile.py"),
      target: path.join(paseoBin, "codex-cliproxy-profile"),
    },
    {
      source: path.join(input.releasePath, "scripts", "antigravity-role"),
      target: path.join(paseoBin, "antigravity-role"),
    },
    {
      source: path.join(input.releasePath, "scripts", "omp-role"),
      target: path.join(paseoBin, "omp-role"),
    },
  ];
}
