import { createHash } from "node:crypto";
import { constants, existsSync, lstatSync, readFileSync, readlinkSync, accessSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { InstallRecord, PathState } from "./schema.js";
import { FoundationManifestSchema, InstallRecordSchema } from "./schema.js";
import {
  resolveInstallLayout,
  resolveProductLayout,
  roleLinks,
  type ProductLayout,
} from "./layout.js";

interface ToolProbe {
  id: string;
  commands: string[];
  versionArgs: string[];
}

export interface ToolInspection {
  id: string;
  command: string | null;
  version: string | null;
}

export interface ProviderInspection {
  id: string;
  enabled: boolean | null;
  hasCustomCommand: boolean;
  envKeys: string[];
}

export interface LinkInspection {
  source: string;
  target: string;
  state: PathState;
  previousTarget: string | null;
}

export interface MachineInspection {
  platform: string;
  architecture: string;
  home: string;
  productRoot: string;
  distributionVersion: string;
  foundationCommit: string;
  paseoDaemonReachable: boolean;
  tools: ToolInspection[];
  providers: ProviderInspection[];
  links: LinkInspection[];
  currentLink: LinkInspection;
  installRecord: InstallRecord | null;
  legacyInstallRecordPresent: boolean;
  controlHomePresent: boolean;
  releasePresent: boolean;
  mutationFingerprint: string;
}

const TOOL_PROBES: ToolProbe[] = [
  { id: "git", commands: ["git"], versionArgs: ["--version"] },
  { id: "node", commands: ["node"], versionArgs: ["--version"] },
  { id: "npm", commands: ["npm"], versionArgs: ["--version"] },
  { id: "jq", commands: ["jq"], versionArgs: ["--version"] },
  { id: "paseo", commands: ["paseo"], versionArgs: ["--version"] },
  { id: "codex", commands: ["codex"], versionArgs: ["--version"] },
  { id: "claude", commands: ["claude"], versionArgs: ["--version"] },
  { id: "opencode", commands: ["opencode"], versionArgs: ["--version"] },
  { id: "omp", commands: ["omp"], versionArgs: ["--version"] },
  { id: "antigravity", commands: ["agy", "antigravity"], versionArgs: ["--version"] },
  { id: "cursor", commands: ["cursor-agent"], versionArgs: ["--version"] },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function executablePath(command: string, environmentPath: string): string | null {
  for (const directory of environmentPath.split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, command);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

function inspectTool(probe: ToolProbe, environmentPath: string): ToolInspection {
  const command = probe.commands
    .map((candidate) => executablePath(candidate, environmentPath))
    .find((candidate) => candidate !== null);
  if (!command) return { id: probe.id, command: null, version: null };
  const processResult = spawnSync(command, probe.versionArgs, {
    encoding: "utf8",
    timeout: 2_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = `${processResult.stdout ?? ""}\n${processResult.stderr ?? ""}`.trim();
  const firstLine = output.split(/\r?\n/u)[0]?.trim() ?? "";
  return { id: probe.id, command, version: firstLine || null };
}

function resolveLinkTarget(linkPath: string): string | null {
  try {
    if (!lstatSync(linkPath).isSymbolicLink()) return null;
    const rawTarget = readlinkSync(linkPath);
    return path.resolve(path.dirname(linkPath), rawTarget);
  } catch {
    return null;
  }
}

function nodeExists(nodePath: string): boolean {
  try {
    lstatSync(nodePath);
    return true;
  } catch {
    return false;
  }
}

function classifyPath(input: {
  target: string;
  source: string;
  shareRoot: string;
}): LinkInspection {
  if (!nodeExists(input.target)) {
    return { source: input.source, target: input.target, state: "absent", previousTarget: null };
  }
  const previousTarget = resolveLinkTarget(input.target);
  if (!previousTarget) {
    return { source: input.source, target: input.target, state: "foreign", previousTarget: null };
  }
  if (previousTarget === input.source) {
    return { source: input.source, target: input.target, state: "owned-current", previousTarget };
  }
  const releasesRoot = path.join(input.shareRoot, "releases") + path.sep;
  if (previousTarget.startsWith(releasesRoot)) {
    return { source: input.source, target: input.target, state: "owned-stale", previousTarget };
  }
  const isLegacyFoundation =
    previousTarget.includes(`${path.sep}paseo-foundation${path.sep}`) ||
    previousTarget.includes(`${path.sep}paseo-workflow-project${path.sep}`);
  if (isLegacyFoundation) {
    return { source: input.source, target: input.target, state: "legacy-owned", previousTarget };
  }
  return { source: input.source, target: input.target, state: "foreign", previousTarget };
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function providerMap(config: Record<string, unknown>): Record<string, unknown> {
  const directProviders = config.providers;
  if (isRecord(directProviders)) return directProviders;
  const agents = config.agents;
  if (!isRecord(agents)) return {};
  const providers = agents.providers;
  return isRecord(providers) ? providers : {};
}

function inspectProviders(configPath: string): ProviderInspection[] {
  if (!existsSync(configPath)) return [];
  const parsed: unknown = readJson(configPath);
  if (!isRecord(parsed)) return [];
  return Object.entries(providerMap(parsed))
    .map(([id, rawProvider]) => {
      if (!isRecord(rawProvider)) {
        return { id, enabled: null, hasCustomCommand: false, envKeys: [] };
      }
      const enabled = typeof rawProvider.enabled === "boolean" ? rawProvider.enabled : null;
      const environment = rawProvider.env;
      const envKeys = isRecord(environment) ? Object.keys(environment).sort() : [];
      return {
        id,
        enabled,
        hasCustomCommand: Array.isArray(rawProvider.command),
        envKeys,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function inspectInstallRecord(recordPath: string): InstallRecord | null {
  if (!existsSync(recordPath)) return null;
  const parsed: unknown = readJson(recordPath);
  const record = InstallRecordSchema.safeParse(parsed);
  return record.success ? record.data : null;
}

function daemonReachable(paseoCommand: string | null, home: string): boolean {
  if (!paseoCommand) return false;
  const processResult = spawnSync(
    paseoCommand,
    ["daemon", "status", "--home", path.join(home, ".paseo")],
    {
      encoding: "utf8",
      timeout: 4_000,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return processResult.status === 0;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function inspectMachine(
  input: {
    home?: string;
    productRoot?: string;
    environmentPath?: string;
    platform?: string;
    architecture?: string;
  } = {},
): MachineInspection {
  const home = path.resolve(input.home ?? os.homedir());
  const product: ProductLayout = resolveProductLayout(input.productRoot);
  const manifestRaw: unknown = readJson(product.manifestPath);
  const manifest = FoundationManifestSchema.parse(manifestRaw);
  const install = resolveInstallLayout({ home, distributionVersion: manifest.distributionVersion });
  const links = roleLinks({ home, releasePath: install.releasePath }).map((link) =>
    classifyPath({ ...link, shareRoot: install.shareRoot }),
  );
  const currentLink = classifyPath({
    target: install.currentLink,
    source: install.releasePath,
    shareRoot: install.shareRoot,
  });
  const environmentPath = input.environmentPath ?? process.env.PATH ?? "";
  const tools = TOOL_PROBES.map((probe) => inspectTool(probe, environmentPath));
  const paseoTool = tools.find((tool) => tool.id === "paseo") ?? null;
  const mutationState = {
    links: links.map(({ target, state, previousTarget }) => ({ target, state, previousTarget })),
    currentLink: {
      target: currentLink.target,
      state: currentLink.state,
      previousTarget: currentLink.previousTarget,
    },
    installRecord: existsSync(install.installRecordPath)
      ? createHash("sha256").update(readFileSync(install.installRecordPath)).digest("hex")
      : null,
    controlHomePresent: nodeExists(install.controlHome),
    releasePresent: nodeExists(install.releasePath),
  };
  return {
    platform: input.platform ?? process.platform,
    architecture: input.architecture ?? process.arch,
    home,
    productRoot: product.productRoot,
    distributionVersion: manifest.distributionVersion,
    foundationCommit: manifest.foundationSource.commit,
    paseoDaemonReachable: daemonReachable(paseoTool?.command ?? null, home),
    tools,
    providers: inspectProviders(path.join(home, ".paseo", "config.json")),
    links,
    currentLink,
    installRecord: inspectInstallRecord(install.installRecordPath),
    legacyInstallRecordPresent: nodeExists(install.legacyRecordPath),
    controlHomePresent: nodeExists(install.controlHome),
    releasePresent: nodeExists(install.releasePath),
    mutationFingerprint: fingerprint(mutationState),
  };
}
