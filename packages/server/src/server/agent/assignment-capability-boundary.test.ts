import { expect, test } from "vitest";

import type { AgentSessionConfig } from "./agent-sdk-types.js";
import {
  assertRoleAssignmentModeAllowed,
  assertRoleAssignmentPermissionResponseAllowed,
  enforceRoleAssignmentCapability,
  requiredNoWriteMode,
} from "./assignment-capability-boundary.js";
import type { PersistedRoleBinding } from "./role-binding.js";

function roleBinding(input: {
  injectionMethod: PersistedRoleBinding["injectionMethod"];
  mutationMode?: "no-write" | "bounded-write";
}): PersistedRoleBinding {
  const mutationMode = input.mutationMode ?? "no-write";
  return {
    roleId: "lead",
    injectionMethod: input.injectionMethod,
    assignment: {
      mutationBoundary:
        mutationMode === "no-write"
          ? { mode: "no-write" }
          : { mode: "bounded-write", scope: "src/**" },
    },
  } as PersistedRoleBinding;
}

test("no-write Codex assignment overrides an unattended full-access request", () => {
  const config: AgentSessionConfig = {
    provider: "codex",
    cwd: "/workspace/repo",
    modeId: "full-access",
  };

  expect(
    enforceRoleAssignmentCapability(
      config,
      roleBinding({ injectionMethod: "codex-developer-instructions" }),
    ),
  ).toMatchObject({ modeId: "read-only" });
});

test("no-write Cursor assignment disables ACP auto-accept and pins plan mode", () => {
  const config: AgentSessionConfig = {
    provider: "cursor",
    cwd: "/workspace/repo",
    modeId: "agent",
    featureValues: { auto_accept: true, fast: true },
  };

  expect(
    enforceRoleAssignmentCapability(
      config,
      roleBinding({ injectionMethod: "cursor-project-rule-capsule" }),
    ),
  ).toMatchObject({ modeId: "plan", featureValues: { auto_accept: false, fast: true } });
});

test("bounded-write assignment preserves the requested provider capability", () => {
  const config: AgentSessionConfig = {
    provider: "claude",
    cwd: "/workspace/repo",
    modeId: "bypassPermissions",
  };

  expect(
    enforceRoleAssignmentCapability(
      config,
      roleBinding({
        injectionMethod: "claude-system-prompt",
        mutationMode: "bounded-write",
      }),
    ),
  ).toBe(config);
});

test("no-write assignment fails closed for a provider without a qualified mode", () => {
  expect(() =>
    requiredNoWriteMode(roleBinding({ injectionMethod: "omp-append-system-prompt" })),
  ).toThrow("assignment_capability_boundary_required");
});

test("no-write assignment rejects mode and permission escalation", () => {
  const binding = roleBinding({ injectionMethod: "claude-system-prompt" });

  expect(() => assertRoleAssignmentModeAllowed(binding, "bypassPermissions")).toThrow(
    "pinned to provider mode 'plan'",
  );
  expect(() =>
    assertRoleAssignmentPermissionResponseAllowed(binding, { behavior: "allow" }),
  ).toThrow("cannot approve a permission escalation");
  expect(() =>
    assertRoleAssignmentPermissionResponseAllowed(binding, { behavior: "deny" }),
  ).not.toThrow();
});
