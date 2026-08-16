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
  legacyRoleLinks,
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
  paseoDaemonEvidence: string[];
  paseoDaemonIdentity: PaseoDaemonIdentity | null;
  tools: ToolInspection[];
  providers: ProviderInspection[];
  links: LinkInspection[];
  currentLink: LinkInspection;
  installRecord: InstallRecord | null;
  legacyInstallRecordPresent: boolean;
  controlHomePresent: boolean;
  releasePresent: boolean;
  interruptedTransactionPresent: boolean;
  mutationFingerprint: string;
}

export interface PaseoDaemonIdentity {
  serverId: string;
  pid: number;
  version: string;
  startedAt: string;
  sourceCommit: string;
  sourceFingerprint: string;
  availableProviders: string[];
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

interface DaemonReadback {
  reachable: boolean;
  evidence: string[];
  identity?: PaseoDaemonIdentity;
}

interface DaemonDiskIdentity {
  paseoHome: string;
  serverId: string;
  pid: number;
  pidInfo: Record<string, unknown>;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

function readDaemonDiskIdentity(home: string): DaemonDiskIdentity | DaemonReadback {
  const paseoHome = path.join(home, ".paseo");
  const configPath = path.join(paseoHome, "config.json");
  const serverIdPath = path.join(paseoHome, "server-id");
  const pidPath = path.join(paseoHome, "paseo.pid");
  const missing = [configPath, serverIdPath, pidPath].filter((filePath) => !existsSync(filePath));
  if (missing.length > 0) {
    return {
      reachable: false,
      evidence: missing.map((filePath) => `${filePath}: missing`),
    };
  }

  let serverId: string;
  let pidInfo: Record<string, unknown>;
  try {
    serverId = readFileSync(serverIdPath, "utf8").trim();
    const parsedPid: unknown = readJson(pidPath);
    if (!isRecord(parsedPid)) throw new Error("PID lock is not an object");
    pidInfo = parsedPid;
  } catch (error) {
    return {
      reachable: false,
      evidence: [error instanceof Error ? error.message : String(error)],
    };
  }
  const pid = pidInfo.pid;
  if (!serverId) return { reachable: false, evidence: ["Paseo server ID is blank"] };
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    return { reachable: false, evidence: ["Paseo PID lock is invalid"] };
  }
  if (!isProcessRunning(pid)) {
    return { reachable: false, evidence: [`Paseo PID ${pid} is not running`] };
  }
  return { paseoHome, serverId, pid, pidInfo };
}

function parseDaemonStatus(stdout: string): { status: Record<string, unknown> } | DaemonReadback {
  try {
    const parsedStatus: unknown = JSON.parse(stdout);
    if (!isRecord(parsedStatus)) throw new Error("Paseo daemon status is not an object");
    return { status: parsedStatus };
  } catch (error) {
    return {
      reachable: false,
      evidence: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function daemonStatusFailures(
  status: Record<string, unknown>,
  identity: DaemonDiskIdentity,
): string[] {
  const failures: string[] = [];
  if (status.localDaemon !== "running") failures.push("local daemon is not running");
  if (status.connectedDaemon !== "reachable") failures.push("daemon websocket is not reachable");
  if (status.serverId !== identity.serverId)
    failures.push("daemon server ID does not match disk state");
  if (status.pid !== identity.pid) failures.push("daemon PID does not match the local PID lock");
  if (status.connectedServerId !== identity.serverId) {
    failures.push("connected daemon server ID does not match the local server ID");
  }
  if (
    typeof status.connectedPid !== "number" ||
    !Number.isInteger(status.connectedPid) ||
    status.connectedPid <= 0 ||
    !isProcessRunning(status.connectedPid)
  ) {
    failures.push("connected daemon PID is unavailable or not running");
  }
  if (
    typeof status.home !== "string" ||
    path.resolve(status.home) !== path.resolve(identity.paseoHome)
  ) {
    failures.push("daemon home does not match the inspected Paseo home");
  }
  const lockedListen = typeof identity.pidInfo.listen === "string" ? identity.pidInfo.listen : null;
  if (lockedListen && status.listen !== lockedListen) {
    failures.push("daemon listen target does not match the local PID lock");
  }
  if (lockedListen && status.connectedListen !== lockedListen) {
    failures.push("connected daemon listen target does not match the local PID lock");
  }
  if (typeof status.daemonVersion !== "string" || !status.daemonVersion.trim()) {
    failures.push("daemon version readback is unavailable");
  }
  failures.push(...daemonProvenanceFailures(status));
  return failures;
}

function daemonProvenanceFailures(status: Record<string, unknown>): string[] {
  const failures: string[] = [];
  if (typeof status.startedAt !== "string" || !Number.isFinite(Date.parse(status.startedAt))) {
    failures.push("daemon start time readback is unavailable");
  }
  if (typeof status.sourceCommit !== "string" || !/^[a-f0-9]{40}$/u.test(status.sourceCommit)) {
    failures.push("daemon source commit readback is unavailable");
  }
  if (
    typeof status.sourceFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/u.test(status.sourceFingerprint)
  ) {
    failures.push("daemon source fingerprint readback is unavailable");
  }
  if (!Array.isArray(status.providers))
    failures.push("daemon provider catalog readback is unavailable");
  return failures;
}

function availableProviderIds(status: Record<string, unknown>): string[] {
  if (!Array.isArray(status.providers)) return [];
  return status.providers
    .flatMap((provider) =>
      isRecord(provider) && typeof provider.label === "string" && provider.path === "available"
        ? [provider.label]
        : [],
    )
    .sort();
}

function daemonReadback(paseoCommand: string | null, home: string): DaemonReadback {
  if (!paseoCommand) return { reachable: false, evidence: ["Paseo CLI is unavailable"] };
  const identity = readDaemonDiskIdentity(home);
  if ("reachable" in identity) return identity;

  const processResult = spawnSync(
    paseoCommand,
    ["daemon", "status", "--home", identity.paseoHome, "--json"],
    {
      encoding: "utf8",
      timeout: 4_000,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (processResult.status !== 0) {
    return {
      reachable: false,
      evidence: [`Paseo daemon status exited ${processResult.status ?? "without a status"}`],
    };
  }

  const parsedStatus = parseDaemonStatus(processResult.stdout ?? "");
  if ("reachable" in parsedStatus) return parsedStatus;
  const { status } = parsedStatus;
  const failures = daemonStatusFailures(status, identity);
  return failures.length > 0
    ? { reachable: false, evidence: failures }
    : {
        reachable: true,
        evidence: [
          `serverId=${identity.serverId}`,
          `pid=${identity.pid}`,
          `version=${status.daemonVersion}`,
        ],
        identity: {
          serverId: identity.serverId,
          pid: identity.pid,
          version: String(status.daemonVersion),
          startedAt: String(status.startedAt),
          sourceCommit: String(status.sourceCommit),
          sourceFingerprint: String(status.sourceFingerprint),
          availableProviders: availableProviderIds(status),
        },
      };
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
  // These are retirement candidates, never desired runtime links.
  const links = legacyRoleLinks({
    home,
    releasePath: install.releasePath,
    skillInventoryRoot: product.distributionRoot,
  }).map((link) => classifyPath({ ...link, shareRoot: install.shareRoot }));
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
    releasePresent: nodeExists(install.releasePath),
    interruptedTransactionPresent: nodeExists(install.transactionPath),
  };
  const daemon = daemonReadback(paseoTool?.command ?? null, home);
  return {
    platform: input.platform ?? process.platform,
    architecture: input.architecture ?? process.arch,
    home,
    productRoot: product.productRoot,
    distributionVersion: manifest.distributionVersion,
    foundationCommit: manifest.foundationSource.commit,
    paseoDaemonReachable: daemon.reachable,
    paseoDaemonEvidence: daemon.evidence,
    paseoDaemonIdentity: daemon.identity ?? null,
    tools,
    providers: inspectProviders(path.join(home, ".paseo", "config.json")),
    links,
    currentLink,
    installRecord: inspectInstallRecord(install.installRecordPath),
    legacyInstallRecordPresent: nodeExists(install.legacyRecordPath),
    controlHomePresent: nodeExists(install.controlHome),
    releasePresent: nodeExists(install.releasePath),
    interruptedTransactionPresent: nodeExists(install.transactionPath),
    mutationFingerprint: fingerprint(mutationState),
  };
}
