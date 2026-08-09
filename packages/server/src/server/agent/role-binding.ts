import { createHash } from "node:crypto";
import { lstat, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  PaseoRoleIdSchema,
  RoleBindingReceiptSchema,
  type PaseoRoleId,
  type ProviderNativeRoleBindingConfig,
  type ProviderRoleBindingSupport,
  type RoleBindingInjectionMethod,
  type RoleBindingReceipt,
  type WorkspaceProtocolBindingReceipt,
} from "@getpaseo/protocol/role-binding";
import type { ProviderPaseoToolsPolicy } from "@getpaseo/protocol/provider-config";
import { z } from "zod";

import {
  ExecutionProfileBindingReceiptSchema,
  foundationExecutionProfileDefinitionDigest,
  getFoundationExecutionProfileDefinition,
  type FoundationExecutionProfileId,
} from "./foundation-execution-profiles.js";
import { getFoundationRoleDefinition } from "./foundation-role-definitions.js";

export const PersistedRoleBindingSchema = RoleBindingReceiptSchema.extend({
  instructions: z.string().min(1),
  executionProfile: ExecutionProfileBindingReceiptSchema.optional(),
});

export type PersistedRoleBinding = z.infer<typeof PersistedRoleBindingSchema>;

export interface MaterializeRoleBindingInput {
  roleId: PaseoRoleId;
  executionProfileId?: FoundationExecutionProfileId;
  provider: string;
  providerBaseId?: string | null;
  providerSupport?: ProviderRoleBindingSupport;
  cwd: string;
  createdAt?: Date;
}

const SUPERVISOR_PASEO_TOOLS = [
  "list_workspaces",
  "list_workspace_scripts",
  "get_agent_status",
  "list_agents",
  "get_agent_activity",
  "list_pending_permissions",
  "list_terminals",
  "capture_terminal",
  "list_schedules",
  "inspect_schedule",
  "schedule_logs",
  "list_providers",
  "list_models",
  "inspect_provider",
  "signal_agent",
  "resolve_agent_signal",
] as const;

const COUNCIL_LEAD_COMPATIBILITY_MARKER = [
  "Council compatibility marker for the native Paseo Lead:",
  "Room role: Root",
  "This legacy marker admits Lead-only Council execution; it does not create another role or broaden the current lease.",
].join("\n");

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

class WorkspaceProtocolValidationError extends Error {
  constructor(
    readonly protocolPath: string,
    readonly reason: string,
    options?: ErrorOptions,
  ) {
    super(`Invalid WORKSPACE_PROTOCOL.md at '${protocolPath}': ${reason}`, options);
    this.name = "WorkspaceProtocolValidationError";
  }
}

function hasErrorCode(error: unknown): error is Error & { code: string } {
  return error instanceof Error && "code" in error && typeof error.code === "string";
}

function assertValidWorkspaceProtocol(bytes: string, protocolPath: string): void {
  if (!bytes.trim()) {
    throw new WorkspaceProtocolValidationError(protocolPath, "root protocol is blank");
  }
  if (/\{\{REQUIRED:[^{}]+\}\}/u.test(bytes)) {
    throw new WorkspaceProtocolValidationError(protocolPath, "unresolved required placeholder");
  }
  if (["<<<<<<<", "=======", ">>>>>>>"].some((marker) => bytes.includes(marker))) {
    throw new WorkspaceProtocolValidationError(protocolPath, "merge conflict marker is present");
  }

  const markerPattern = /<!--[^>]*PASEO_WORKSPACE_PROTOCOL_VERSION[^>]*-->/gu;
  const markers = bytes.match(markerPattern) ?? [];
  if (markers.length > 1) {
    throw new WorkspaceProtocolValidationError(protocolPath, "protocol marker is duplicated");
  }
  const supportedMarkers = new Set([
    "<!-- PASEO_WORKSPACE_PROTOCOL_VERSION: 1 -->",
    "<!-- PASEO_WORKSPACE_PROTOCOL_VERSION: 2 -->",
  ]);
  if (markers.length === 1 && !supportedMarkers.has(markers[0]?.trim() ?? "")) {
    throw new WorkspaceProtocolValidationError(protocolPath, "protocol marker is not supported");
  }

  const normalized = bytes.toLocaleLowerCase("en-US");
  const identityCategories = [
    [/\bowner\b/u, /chủ sở hữu/u, /\bauthority\b/u, /thẩm quyền/u],
    [/\bapplies_to\b/u, /áp dụng/u, /phạm vi/u, /\brepository\b/u, /\bproject\b/u],
    [/\bversion\b/u, /\blast_reviewed\b/u, /trạng thái/u, /\bstatus\b/u, /\breview/u, /hiệu lực/u],
  ];
  const matchedCategories = identityCategories.filter((category) =>
    category.some((pattern) => pattern.test(normalized)),
  ).length;
  if (matchedCategories < 2) {
    throw new WorkspaceProtocolValidationError(
      protocolPath,
      "minimal owner, scope, or review identity is missing",
    );
  }
}

function resolveProviderFamily(provider: string, providerBaseId?: string | null): string {
  return providerBaseId ?? provider;
}

function commandBasename(command: string): string {
  return command.split(/[\\/]/u).at(-1) ?? command;
}

function resolveBuiltInRoleBindingSupport(family: string): ProviderRoleBindingSupport | null {
  const injectionMethods: Partial<Record<string, RoleBindingInjectionMethod>> = {
    codex: "codex-developer-instructions",
    claude: "claude-system-prompt",
    pi: "pi-before-agent-start",
    omp: "omp-append-system-prompt",
  };
  const injectionMethod = injectionMethods[family];
  return injectionMethod ? { status: "supported", injectionMethod } : null;
}

function commandMatchesExecutable(
  command: readonly string[] | undefined,
  names: readonly string[],
): boolean {
  const executable = command?.[0] ? commandBasename(command[0]) : null;
  return executable !== null && names.includes(executable);
}

function resolveCursorACPRoleBindingSupport(
  command: readonly string[] | undefined,
): ProviderRoleBindingSupport {
  const acpCommandCount = command?.filter((argument) => argument === "acp").length ?? 0;
  const hasCallerWorkspace =
    command?.some(
      (argument) => argument === "--workspace" || argument.startsWith("--workspace="),
    ) ?? false;
  if (
    !commandMatchesExecutable(command, ["cursor-agent", "cursor-agent.exe"]) ||
    acpCommandCount !== 1 ||
    hasCallerWorkspace
  ) {
    return {
      status: "unsupported",
      reason:
        "Cursor native role binding requires exact 'cursor-agent ... acp' launch without a caller-supplied --workspace",
    };
  }
  return {
    status: "supported",
    injectionMethod: "cursor-project-rule-capsule",
  };
}

function resolveAntigravityACPRoleBindingSupport(
  command: readonly string[] | undefined,
): ProviderRoleBindingSupport {
  if (process.platform === "win32") {
    return {
      status: "unsupported",
      reason: "Antigravity native role binding is not implemented on Windows",
    };
  }
  const binaryFlagIndexes = (command ?? []).flatMap((argument, index) =>
    argument === "--agy-binary" ? [index] : [],
  );
  if (
    !commandMatchesExecutable(command, ["agy-acp", "agy-acp.exe"]) ||
    binaryFlagIndexes.length !== 1 ||
    !command?.[binaryFlagIndexes[0] + 1] ||
    command.some((argument) => argument === "--agent" || argument.startsWith("--agent="))
  ) {
    return {
      status: "unsupported",
      reason:
        "Antigravity native role binding requires one --agy-binary value and rejects caller-supplied --agent arguments",
    };
  }
  return {
    status: "supported",
    injectionMethod: "antigravity-custom-agent",
    notice:
      "agy-acp is a third-party bridge. Review Google's current Antigravity authentication terms before using an account through it.",
  };
}

function resolveConfiguredACPRoleBindingSupport(
  nativeRoleBinding: ProviderNativeRoleBindingConfig | undefined,
  command: readonly string[] | undefined,
): ProviderRoleBindingSupport | null {
  if (nativeRoleBinding?.driver === "cursor-plugin") {
    return {
      status: "unsupported",
      reason:
        "The cursor-plugin role driver is retired because Cursor may silently ignore local plugins. Remove it or use cursor-workspace-rule.",
    };
  }
  if (nativeRoleBinding?.driver === "cursor-workspace-rule") {
    return resolveCursorACPRoleBindingSupport(command);
  }
  if (nativeRoleBinding?.driver === "antigravity-custom-agent") {
    return resolveAntigravityACPRoleBindingSupport(command);
  }
  if (commandMatchesExecutable(command, ["cursor-agent", "cursor-agent.exe"])) {
    return resolveCursorACPRoleBindingSupport(command);
  }
  if (commandMatchesExecutable(command, ["agy-acp", "agy-acp.exe"])) {
    return resolveAntigravityACPRoleBindingSupport(command);
  }
  return null;
}

export function detectLegacyProviderRole(
  command: readonly string[] | undefined,
): PaseoRoleId | null {
  if (!command || command.length < 2) return null;

  const executable = commandBasename(command[0]);
  if (
    [
      "codex-profile",
      "codex-profile.py",
      "codex-cliproxy-profile",
      "codex-cliproxy-profile.py",
      "omp-role",
    ].includes(executable)
  ) {
    const parsed = PaseoRoleIdSchema.safeParse(command[1]);
    return parsed.success ? parsed.data : null;
  }

  if (executable === "claude" || executable === "claude.exe") {
    const agentFlag = command.indexOf("--agent");
    const agentName = agentFlag >= 0 ? command[agentFlag + 1] : undefined;
    const match = agentName?.match(/^paseo-(lead|peer|supervisor)$/u);
    if (match) {
      return PaseoRoleIdSchema.parse(match[1]);
    }
  }

  return null;
}

export function resolveProviderRoleBindingSupport(
  provider: string,
  providerBaseId?: string | null,
  legacyRoleId?: PaseoRoleId | null,
  nativeRoleBinding?: ProviderNativeRoleBindingConfig,
  command?: readonly string[],
): ProviderRoleBindingSupport {
  if (legacyRoleId) {
    return {
      status: "unsupported",
      reason:
        `Legacy provider transport is already pinned to Paseo role '${legacyRoleId}'. ` +
        "Use a transport-only provider in the native role-first flow.",
    };
  }
  const family = resolveProviderFamily(provider, providerBaseId);
  const builtInSupport = resolveBuiltInRoleBindingSupport(family);
  if (builtInSupport) return builtInSupport;
  const configuredSupport = resolveConfiguredACPRoleBindingSupport(nativeRoleBinding, command);
  if (configuredSupport) return configuredSupport;
  return {
    status: "unsupported",
    reason: `Provider family '${family}' has no qualified native durable role-instruction channel`,
  };
}

function protocolReadership(roleId: PaseoRoleId): WorkspaceProtocolBindingReceipt["readership"] {
  if (roleId === "lead") return "full";
  if (roleId === "supervisor") return "governance-only";
  return "assignment-only";
}

async function inspectWorkspaceProtocol(
  cwd: string,
  roleId: PaseoRoleId,
): Promise<WorkspaceProtocolBindingReceipt> {
  const protocolPath = join(cwd, "WORKSPACE_PROTOCOL.md");
  try {
    await lstat(protocolPath);
  } catch (error) {
    if (hasErrorCode(error) && error.code === "ENOENT") {
      return {
        status: "missing",
        readership: protocolReadership(roleId),
        path: protocolPath,
      };
    }
    throw new WorkspaceProtocolValidationError(protocolPath, "path cannot be inspected", {
      cause: error,
    });
  }

  try {
    const resolvedPath = await stat(protocolPath);
    if (!resolvedPath.isFile()) {
      throw new WorkspaceProtocolValidationError(protocolPath, "path is not a regular file");
    }
    const bytes = await readFile(protocolPath, "utf8");
    assertValidWorkspaceProtocol(bytes, protocolPath);
    return {
      status: "bound",
      readership: protocolReadership(roleId),
      path: protocolPath,
      digest: sha256(bytes),
    };
  } catch (error) {
    if (error instanceof WorkspaceProtocolValidationError) throw error;
    throw new WorkspaceProtocolValidationError(protocolPath, "file cannot be read", {
      cause: error,
    });
  }
}

function buildProtocolInstruction(receipt: WorkspaceProtocolBindingReceipt): string {
  if (receipt.status === "missing") {
    if (receipt.readership === "assignment-only") {
      return `Workspace Protocol binding: absent zero-delta at ${receipt.path}. Do not load that path; no repository-specific protocol constraints are bound, so follow the standing role and bounded assignment.`;
    }
    if (receipt.readership === "governance-only") {
      return `Workspace Protocol binding: absent zero-delta at ${receipt.path}. No repository-specific protocol is bound; create, audit, or update one only under an exact Human governance mandate.`;
    }
    return `Workspace Protocol binding: absent zero-delta at ${receipt.path}. Proceed under the standing Lead role and bounded assignment; no repository-specific policy delta is active.`;
  }
  if (receipt.readership === "assignment-only") {
    return `Workspace Protocol binding: assignment-only. Do not load ${receipt.path}; receive only relevant constraints in the Lead assignment.`;
  }
  if (receipt.readership === "governance-only") {
    return `Workspace Protocol binding: governance-only at ${receipt.path}. Read it only when the exact Human mandate requires protocol create/audit/update. Bound status: ${receipt.status}${receipt.digest ? `; sha256=${receipt.digest}` : ""}.`;
  }
  return `Workspace Protocol binding: full-read required at ${receipt.path}; sha256=${receipt.digest}. Read the exact current file before orchestration. If current bytes no longer match this digest, stop and request a fresh binding instead of relying on stale protocol state.`;
}

export async function materializeRoleBinding(
  input: MaterializeRoleBindingInput,
): Promise<PersistedRoleBinding> {
  const support =
    input.providerSupport ??
    resolveProviderRoleBindingSupport(input.provider, input.providerBaseId);
  if (support.status !== "supported") {
    throw new Error(
      `Provider '${input.provider}' cannot bind Paseo role '${input.roleId}': ${support.reason}`,
    );
  }

  const definition = getFoundationRoleDefinition(input.roleId);
  const executionProfile = input.executionProfileId
    ? getFoundationExecutionProfileDefinition(input.executionProfileId)
    : null;
  if (executionProfile && executionProfile.authorityRoleId !== input.roleId) {
    throw new Error(
      `Execution profile '${executionProfile.id}' requires role '${executionProfile.authorityRoleId}'`,
    );
  }
  const workspaceProtocol = await inspectWorkspaceProtocol(input.cwd, input.roleId);
  const instructions = [
    definition.instructions,
    executionProfile?.instructions,
    input.roleId === "lead" ? COUNCIL_LEAD_COMPATIBILITY_MARKER : null,
    buildProtocolInstruction(workspaceProtocol),
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");

  return {
    roleId: input.roleId,
    definitionVersion: definition.version,
    definitionDigest: sha256(definition.instructions),
    bindingDigest: sha256(instructions),
    provider: input.provider,
    injectionMethod: support.injectionMethod,
    qualification: "implementation-supported",
    workspaceProtocol,
    createdAt: (input.createdAt ?? new Date()).toISOString(),
    instructions,
    ...(executionProfile
      ? {
          executionProfile: {
            id: executionProfile.id,
            version: executionProfile.version,
            definitionDigest: foundationExecutionProfileDefinitionDigest(executionProfile),
          },
        }
      : {}),
  };
}

export function toRoleBindingReceipt(binding: PersistedRoleBinding): RoleBindingReceipt {
  const { instructions: _instructions, executionProfile: _executionProfile, ...receipt } = binding;
  return receipt;
}

function intersectSupervisorTools(providerPolicy: ProviderPaseoToolsPolicy | undefined): string[] {
  let roleTools = [...SUPERVISOR_PASEO_TOOLS];
  if (providerPolicy?.allowedTools) {
    const providerAllowed = new Set(providerPolicy.allowedTools);
    roleTools = roleTools.filter((tool) => providerAllowed.has(tool));
  }
  if (providerPolicy?.disabledTools) {
    const providerDisabled = new Set(providerPolicy.disabledTools);
    roleTools = roleTools.filter((tool) => !providerDisabled.has(tool));
  }
  return roleTools;
}

export function applyRolePaseoToolPolicy(
  roleId: PaseoRoleId | undefined,
  providerPolicy: ProviderPaseoToolsPolicy | undefined,
): ProviderPaseoToolsPolicy | undefined {
  if (!roleId) {
    return providerPolicy;
  }
  if (roleId === "peer") {
    return { enabled: false };
  }
  if (roleId === "lead") {
    return providerPolicy ? { ...providerPolicy, enabled: true } : undefined;
  }
  return {
    enabled: true,
    allowedTools: intersectSupervisorTools(providerPolicy),
  };
}

export function assertPersistedRoleBindingMatches(
  binding: PersistedRoleBinding,
  provider: string,
): void {
  if (binding.provider !== provider) {
    throw new Error(
      `Persisted role binding provider '${binding.provider}' does not match session provider '${provider}'`,
    );
  }
}

export function expectedInjectionMethod(
  provider: string,
  providerBaseId?: string | null,
): RoleBindingInjectionMethod | null {
  const support = resolveProviderRoleBindingSupport(provider, providerBaseId);
  return support.status === "supported" ? support.injectionMethod : null;
}
