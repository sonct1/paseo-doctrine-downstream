import type { RoleBindingInjectionMethod } from "@getpaseo/protocol/role-binding";

import type { AgentPermissionResponse, AgentSessionConfig } from "./agent-sdk-types.js";
import type { PersistedRoleBinding } from "./role-binding.js";

export const ASSIGNMENT_CAPABILITY_BOUNDARY_ERROR = "assignment_capability_boundary_required";

const NO_WRITE_MODE_BY_INJECTION_METHOD: Partial<Record<RoleBindingInjectionMethod, string>> = {
  "codex-developer-instructions": "read-only",
  "claude-system-prompt": "plan",
  "cursor-project-rule-capsule": "plan",
  "cursor-always-apply-plugin": "plan",
  "antigravity-custom-agent": "plan",
  "mock-launch-context": "read-only",
};

function requiresTechnicalNoWrite(roleBinding: PersistedRoleBinding | undefined): boolean {
  return roleBinding?.assignment?.mutationBoundary.mode === "no-write";
}

export function requiredNoWriteMode(roleBinding: PersistedRoleBinding | undefined): string | null {
  if (!roleBinding || !requiresTechnicalNoWrite(roleBinding)) {
    return null;
  }
  const modeId = NO_WRITE_MODE_BY_INJECTION_METHOD[roleBinding.injectionMethod];
  if (!modeId) {
    throw new Error(
      `${ASSIGNMENT_CAPABILITY_BOUNDARY_ERROR}: provider injection '${roleBinding.injectionMethod}' has no qualified no-write mode for ${roleBinding.roleId} assignment`,
    );
  }
  return modeId;
}

export function enforceRoleAssignmentCapability(
  config: AgentSessionConfig,
  roleBinding: PersistedRoleBinding | undefined,
): AgentSessionConfig {
  const modeId = requiredNoWriteMode(roleBinding);
  if (!modeId) {
    return config;
  }
  const disablesAutoAccept =
    roleBinding?.injectionMethod === "cursor-project-rule-capsule" ||
    roleBinding?.injectionMethod === "cursor-always-apply-plugin";
  return {
    ...config,
    modeId,
    ...(disablesAutoAccept
      ? {
          featureValues: {
            ...config.featureValues,
            auto_accept: false,
          },
        }
      : {}),
  };
}

export function assertRoleAssignmentModeAllowed(
  roleBinding: PersistedRoleBinding | undefined,
  requestedModeId: string,
): void {
  const requiredModeId = requiredNoWriteMode(roleBinding);
  if (requiredModeId && requestedModeId !== requiredModeId) {
    throw new Error(
      `${ASSIGNMENT_CAPABILITY_BOUNDARY_ERROR}: no-write ${roleBinding?.roleId ?? "role"} assignment is pinned to provider mode '${requiredModeId}'`,
    );
  }
}

export function assertRoleAssignmentPermissionResponseAllowed(
  roleBinding: PersistedRoleBinding | undefined,
  response: AgentPermissionResponse,
): void {
  if (requiresTechnicalNoWrite(roleBinding) && response.behavior === "allow") {
    throw new Error(
      `${ASSIGNMENT_CAPABILITY_BOUNDARY_ERROR}: no-write ${roleBinding?.roleId ?? "role"} assignment cannot approve a permission escalation`,
    );
  }
}
