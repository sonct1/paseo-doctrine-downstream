import { createHash } from "node:crypto";
import {
  isProviderRoleBindingSupportedForRole,
  PaseoRoleIdSchema,
  RoleBindingReceiptSchema,
  type PaseoRoleId,
  type ProviderNativeRoleBindingConfig,
  type ProviderRoleBindingSupport,
  type RoleBindingInjectionMethod,
  type RoleBindingReceipt,
  type RoleProfileBindingReceipt,
  type WorkspaceProtocolBindingReceipt,
} from "@getpaseo/protocol/role-binding";
import type { RoleProfilePreferences } from "@getpaseo/protocol/role-profile";
import type { ProviderPaseoToolsPolicy } from "@getpaseo/protocol/provider-config";
import type {
  AssignmentAssignerReceipt,
  AssignmentEnvelope,
} from "@getpaseo/protocol/assignment-contract";
import { z } from "zod";

import {
  ExecutionProfileBindingReceiptSchema,
  foundationExecutionProfileDefinitionDigest,
  getFoundationExecutionProfileDefinition,
  type FoundationExecutionProfileId,
} from "./foundation-execution-profiles.js";
import { getFoundationRoleDefinition } from "./foundation-role-definitions.js";
import { loadFoundationSkillPolicy } from "./foundation-skill-policy.js";
import {
  materializeRoleProfileBindingReceipt,
  ROLE_DEFAULT_TOOLS,
  ROLE_TOOL_CEILINGS,
} from "./role-profiles.js";
import { inspectWorkspaceProtocol } from "../../utils/workspace-protocol-file.js";
import {
  buildAssignmentInstruction,
  materializeAssignmentContract,
  PersistedAssignmentContractSchema,
} from "./assignment-contract.js";

export const WORKSPACE_PROTOCOL_ADMISSION_ERROR = "workspace_protocol_admission_required";
export const ASSIGNMENT_CONTRACT_EXPIRED_ERROR = "assignment_contract_expired";

export const PersistedRoleBindingSchema = RoleBindingReceiptSchema.extend({
  instructions: z.string().min(1),
  executionProfile: ExecutionProfileBindingReceiptSchema.optional(),
  assignmentContract: PersistedAssignmentContractSchema.optional(),
});

export type PersistedRoleBinding = z.infer<typeof PersistedRoleBindingSchema>;

export interface MaterializeRoleBindingInput {
  roleId: PaseoRoleId;
  executionProfileId?: FoundationExecutionProfileId;
  provider: string;
  providerBaseId?: string | null;
  providerSupport?: ProviderRoleBindingSupport;
  cwd: string;
  workspaceId: string;
  assignment?: AssignmentEnvelope;
  assignmentAssigner: AssignmentAssignerReceipt;
  roleProfilePreferences?: RoleProfilePreferences;
  createdAt?: Date;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function resolveProviderFamily(provider: string, providerBaseId?: string | null): string {
  return providerBaseId ?? provider;
}

function commandBasename(command: string): string {
  return command.split(/[\\/]/u).at(-1) ?? command;
}

function resolveBuiltInRoleBindingSupport(family: string): ProviderRoleBindingSupport | null {
  if (family === "mock") {
    return {
      status: "supported",
      injectionMethod: "mock-launch-context",
      notice: "Development-only synthetic provider; role instructions are bound at session launch.",
    };
  }
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
  const hasCallerPermissionPolicy =
    command?.some(
      (argument) =>
        argument === "-f" ||
        argument === "--force" ||
        argument === "--yolo" ||
        argument === "--auto-review" ||
        argument === "--approve-mcps" ||
        argument === "--trust" ||
        argument === "--mode" ||
        argument.startsWith("--mode=") ||
        argument === "--sandbox" ||
        argument.startsWith("--sandbox="),
    ) ?? false;
  if (
    !commandMatchesExecutable(command, ["cursor-agent", "cursor-agent.exe"]) ||
    acpCommandCount !== 1 ||
    hasCallerWorkspace ||
    hasCallerPermissionPolicy
  ) {
    return {
      status: "unsupported",
      reason:
        "Cursor native role binding requires exact 'cursor-agent ... acp' launch without caller-supplied workspace or permission-policy flags",
    };
  }
  return {
    status: "supported",
    injectionMethod: "cursor-project-rule-capsule",
  };
}

function resolveAntigravityNativeRoleBindingSupport(
  command: readonly string[] | undefined,
  hasPaseoToolTransport?: boolean,
): ProviderRoleBindingSupport {
  if (process.platform === "win32") {
    return {
      status: "unsupported",
      reason: "Antigravity native role binding is not implemented on Windows",
      roleIds: ["peer"],
    };
  }
  const isNativeCommand =
    commandMatchesExecutable(command, ["agy", "agy.exe"]) && command?.length === 1;
  if (!isNativeCommand) {
    return {
      status: "unsupported",
      reason: "Antigravity native role binding requires the exact command ['agy']",
      roleIds: ["peer"],
    };
  }
  if (hasPaseoToolTransport === false) {
    return {
      status: "unsupported",
      reason:
        "The current Antigravity runtime has no qualified native Paseo-tool transport for the mandatory Beads checkpoint",
      roleIds: ["peer"],
    };
  }
  return {
    status: "supported",
    injectionMethod: "antigravity-custom-agent",
    roleIds: ["peer"],
    notice:
      "Antigravity uses the official native AGY CLI with a caller-scoped Paseo command gateway and has a Peer-only eligibility ceiling.",
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
  if (commandMatchesExecutable(command, ["cursor-agent", "cursor-agent.exe"])) {
    return resolveCursorACPRoleBindingSupport(command);
  }
  return null;
}

// COMPAT(legacyProviderRoleDetection): fail-closed migration guard only. Delete after
// 2026-09-30 together with Foundation legacy role-link inventory; no installer creates these.
export const LEGACY_PROVIDER_ROLE_DETECTION_EXPIRES_AT = "2026-09-30";

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
  hasPaseoToolTransport?: boolean,
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
  if (family === "gemini-antigravity") {
    return resolveAntigravityNativeRoleBindingSupport(command ?? ["agy"], hasPaseoToolTransport);
  }
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

function requireWorkspaceProtocol(
  cwd: string,
  roleId: PaseoRoleId,
  allowMissing: boolean,
): WorkspaceProtocolBindingReceipt {
  const snapshot = inspectWorkspaceProtocol(cwd);
  if (snapshot.status === "missing") {
    if (!allowMissing) {
      throw new Error(`${WORKSPACE_PROTOCOL_ADMISSION_ERROR}: missing: ${snapshot.path}`);
    }
    return {
      status: "missing",
      readership: protocolReadership(roleId),
      path: snapshot.path,
    };
  }
  if (snapshot.status !== "valid") {
    const details =
      snapshot.status === "invalid" && snapshot.issues.length > 0
        ? `; issues=${snapshot.issues.join(",")}`
        : "";
    throw new Error(
      `${WORKSPACE_PROTOCOL_ADMISSION_ERROR}: ${snapshot.status}: ${snapshot.path}${details}`,
    );
  }
  return {
    status: "bound",
    readership: protocolReadership(roleId),
    path: snapshot.path,
    digest: snapshot.revision.sha256,
  };
}

function buildProtocolInstruction(
  receipt: WorkspaceProtocolBindingReceipt,
  hasProtocolException: boolean,
): string {
  if (receipt.status === "missing") {
    if (!hasProtocolException) {
      // Admitted because this assignment is read-only with no external effects. State the gap
      // plainly so the agent reports it instead of inferring that the repository has no rules.
      return `Workspace Protocol binding: not yet bootstrapped at ${receipt.path}. This assignment was admitted because it declares no write scope and no external effects. Treat the repository's coordination tactics as unknown rather than absent, stay non-mutating, and report that the protocol still needs bootstrapping at handback. Any write scope or external effect requires a bound protocol or an exact Human exception first.`;
    }
    if (receipt.readership === "assignment-only") {
      return `Workspace Protocol binding: temporarily missing under an exact Human bootstrap exception at ${receipt.path}. Do not load that path; remain inside the read-only/bootstrap assignment and stop at its expiry.`;
    }
    if (receipt.readership === "governance-only") {
      return `Workspace Protocol binding: temporarily missing under an exact Human governance exception at ${receipt.path}. Create, audit, or update it only inside that bounded mandate and stop at its expiry.`;
    }
    return `Workspace Protocol binding: temporarily missing under an exact Human bootstrap exception at ${receipt.path}. Bootstrap only the bounded governance artifact and stop at the assignment expiry.`;
  }
  if (receipt.readership === "assignment-only") {
    return `Workspace Protocol binding: assignment-only. Do not load ${receipt.path}; receive only relevant constraints in the Lead assignment.`;
  }
  if (receipt.readership === "governance-only") {
    return `Workspace Protocol binding: governance-only at ${receipt.path}. Read it only when the exact Human mandate requires protocol create/audit/update. Bound status: ${receipt.status}${receipt.digest ? `; sha256=${receipt.digest}` : ""}.`;
  }
  return `Workspace Protocol binding: full-read required at ${receipt.path}; sha256=${receipt.digest}. Read the exact current file before orchestration. If current bytes no longer match this digest, stop and request a fresh binding instead of relying on stale protocol state.`;
}

function buildBeadsSkillAdmissionInstruction(
  roleId: PaseoRoleId,
  roleProfile: RoleProfileBindingReceipt,
): string {
  const policy = loadFoundationSkillPolicy(roleId);
  const skillPath = policy.skillPaths.get("beads-issue-tracker");
  if (
    policy.status !== "bound" ||
    !policy.enabledNames.has("beads-issue-tracker") ||
    !roleProfile.allowedSkills.includes("beads-issue-tracker") ||
    !skillPath
  ) {
    throw new Error(
      "foundation_skill_admission_required: beads-issue-tracker is not bound for this role",
    );
  }
  return "Role skill admission: `beads-issue-tracker` is active from the immutable Foundation bundle. Its assignment-start checkpoint, mutation boundary, and handback rule are projected in the Assignment Contract above; do not search for or load a second copy.";
}

export async function materializeRoleBinding(
  input: MaterializeRoleBindingInput,
): Promise<PersistedRoleBinding> {
  const support =
    input.providerSupport ??
    resolveProviderRoleBindingSupport(input.provider, input.providerBaseId);
  if (support.roleIds && !support.roleIds.includes(input.roleId)) {
    throw new Error(
      `Provider '${input.provider}' cannot bind Paseo role '${input.roleId}': provider eligibility is limited to role(s): ${support.roleIds.join(", ")}`,
    );
  }
  if (support.status === "unsupported") {
    throw new Error(
      `Provider '${input.provider}' cannot bind Paseo role '${input.roleId}': ${support.reason}`,
    );
  }
  if (!isProviderRoleBindingSupportedForRole(support, input.roleId)) {
    throw new Error(
      `Provider '${input.provider}' cannot bind Paseo role '${input.roleId}': provider eligibility is limited to role(s): ${support.roleIds?.join(", ") ?? "none"}`,
    );
  }

  const definition = getFoundationRoleDefinition(input.roleId);
  const roleProfile = materializeRoleProfileBindingReceipt(
    input.roleId,
    input.roleProfilePreferences,
  );
  const createdAt = input.createdAt ?? new Date();
  const assignmentContract = materializeAssignmentContract({
    roleId: input.roleId,
    assigner: input.assignmentAssigner,
    workspaceId: input.workspaceId,
    cwd: input.cwd,
    envelope: input.assignment,
    createdAt,
  });
  const executionProfile = input.executionProfileId
    ? getFoundationExecutionProfileDefinition(input.executionProfileId)
    : null;
  if (executionProfile && executionProfile.authorityRoleId !== input.roleId) {
    throw new Error(
      `Execution profile '${executionProfile.id}' requires role '${executionProfile.authorityRoleId}'`,
    );
  }
  // Graduated admission: a missing protocol blocks material work, not every role launch.
  // Read-only work with no external effects proceeds and reports that bootstrap is owed;
  // any write scope or external effect requires a bound protocol or an exact Human exception.
  // An invalid protocol always fails closed, because absence is a gap while corruption is a
  // contradiction we must not silently reinterpret.
  const envelope = assignmentContract.envelope;
  const hasProtocolException = envelope.protocolException !== undefined;
  const performsMaterialWork =
    envelope.mutationBoundary.mode !== "no-write" ||
    envelope.externalEffectBoundary.mode !== "denied";
  const workspaceProtocol = requireWorkspaceProtocol(
    input.cwd,
    input.roleId,
    hasProtocolException || !performsMaterialWork,
  );
  const instructions = [
    definition.instructions,
    executionProfile?.instructions,
    buildProtocolInstruction(workspaceProtocol, hasProtocolException),
    buildAssignmentInstruction(assignmentContract),
    buildBeadsSkillAdmissionInstruction(input.roleId, roleProfile),
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
    assignment: assignmentContract.receipt,
    roleProfile,
    assignmentContract,
    createdAt: createdAt.toISOString(),
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
  return RoleBindingReceiptSchema.parse(binding);
}

function assertAdmissionTimestampCurrent(
  value: string | undefined,
  now: Date,
  field: "expiresAt" | "protocolExceptionExpiresAt",
): void {
  if (value !== undefined && Date.parse(value) <= now.getTime()) {
    throw new Error(`${ASSIGNMENT_CONTRACT_EXPIRED_ERROR}: ${field}=${value}`);
  }
}

/** Revalidate drift-prone authority receipts before every role-bound create or resume. */
export function assertPersistedRoleAdmissionCurrent(
  binding: PersistedRoleBinding,
  cwd: string,
  now = new Date(),
): void {
  assertAdmissionTimestampCurrent(binding.assignment?.expiresAt, now, "expiresAt");
  assertAdmissionTimestampCurrent(
    binding.assignment?.protocolExceptionExpiresAt,
    now,
    "protocolExceptionExpiresAt",
  );

  const current = inspectWorkspaceProtocol(cwd);
  if (binding.workspaceProtocol.path !== current.path) {
    throw new Error(
      `${WORKSPACE_PROTOCOL_ADMISSION_ERROR}: path_changed: bound=${binding.workspaceProtocol.path}; current=${current.path}`,
    );
  }

  if (binding.workspaceProtocol.status === "bound") {
    if (current.status !== "valid") {
      const issues = current.status === "invalid" ? `; issues=${current.issues.join(",")}` : "";
      throw new Error(
        `${WORKSPACE_PROTOCOL_ADMISSION_ERROR}: ${current.status}: ${current.path}${issues}`,
      );
    }
    if (
      !binding.workspaceProtocol.digest ||
      binding.workspaceProtocol.digest !== current.revision.sha256
    ) {
      throw new Error(
        `${WORKSPACE_PROTOCOL_ADMISSION_ERROR}: stale_digest: ${current.path}; bound=${binding.workspaceProtocol.digest ?? "missing"}; current=${current.revision.sha256}`,
      );
    }
    return;
  }

  if (current.status !== "missing") {
    let details: string = current.status;
    if (current.status === "valid") {
      details = "protocol_now_present";
    } else if (current.status === "invalid" && current.issues.length > 0) {
      details = `${current.status}; issues=${current.issues.join(",")}`;
    }
    throw new Error(`${WORKSPACE_PROTOCOL_ADMISSION_ERROR}: ${details}: ${current.path}`);
  }

  const assignment = binding.assignment;
  if (!assignment) {
    throw new Error(
      `${WORKSPACE_PROTOCOL_ADMISSION_ERROR}: missing_protocol_requires_current_assignment: ${current.path}`,
    );
  }
  const performsMaterialWork =
    assignment.mutationBoundary.mode !== "no-write" ||
    assignment.externalEffectBoundary.mode !== "denied";
  if (performsMaterialWork && !assignment.protocolExceptionExpiresAt) {
    throw new Error(
      `${WORKSPACE_PROTOCOL_ADMISSION_ERROR}: missing_protocol_blocks_material_assignment: ${current.path}`,
    );
  }
}

function intersectRoleTools(
  tools: readonly string[],
  providerPolicy: ProviderPaseoToolsPolicy | undefined,
): string[] {
  let roleTools = [...tools];
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
  roleAllowedTools?: readonly string[],
): ProviderPaseoToolsPolicy | undefined {
  if (!roleId) {
    return providerPolicy;
  }
  const ceiling = ROLE_TOOL_CEILINGS[roleId];
  const selected = roleAllowedTools
    ? ceiling.filter((tool) => roleAllowedTools.includes(tool))
    : ROLE_DEFAULT_TOOLS[roleId];
  return {
    enabled: true,
    allowedTools: intersectRoleTools(selected, providerPolicy),
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
