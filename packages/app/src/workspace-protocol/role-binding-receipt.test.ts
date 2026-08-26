import { describe, expect, test } from "vitest";
import { formatRoleBindingReceiptDescription } from "./role-binding-receipt";

describe("role binding receipt description", () => {
  test("shows immutable binding and protocol provenance without instruction bytes", () => {
    const description = formatRoleBindingReceiptDescription("Lead summary", {
      roleId: "lead",
      definitionVersion: "3.3.0-mandatory-protocol-webui",
      definitionDigest: "a".repeat(64),
      bindingDigest: "b".repeat(64),
      provider: "codex",
      injectionMethod: "codex-developer-instructions",
      qualification: "implementation-supported",
      workspaceProtocol: {
        status: "bound",
        readership: "full",
        path: "/repo/WORKSPACE_PROTOCOL.md",
        digest: "c".repeat(64),
      },
      assignment: {
        version: 1,
        assignmentDigest: "d".repeat(64),
        roleId: "lead",
        disposition: "lead-direct",
        assigner: { kind: "human-session" },
        workspaceId: "workspace-1",
        cwd: "/repo",
        effectClass: "mutating",
        mutationBoundary: { mode: "bounded-write", scope: "/repo" },
        externalEffectBoundary: { mode: "denied" },
        createdAt: "2026-08-08T00:00:00.000Z",
      },
      createdAt: "2026-08-08T00:00:00.000Z",
    });

    expect(description).toContain("Contract: 3.3.0-mandatory-protocol-webui");
    expect(description).toContain("Policy owner: legacy-core");
    expect(description).toContain(`Binding: sha256:${"b".repeat(64)}`);
    expect(description).toContain(`Protocol: bound · full · sha256:${"c".repeat(64)}`);
    expect(description).toContain("Assignment: Work & coordinate · immutable");
    expect(description).toContain("Mutation: bounded-write · /repo");
    expect(description).toContain("Assigned by: Human session");
    expect(description).not.toContain("Role: Lead");
  });

  test("shows the exact bundled SLP generation owner", () => {
    const generationDigest = "e".repeat(64);
    const description = formatRoleBindingReceiptDescription("Peer summary", {
      policyOwner: {
        kind: "plugin",
        pluginId: "slp",
        generationDigest,
        policyVersion: "1.0.0",
      },
      roleId: "peer",
      definitionVersion: "3.2.0-topology-recovery",
      definitionDigest: "a".repeat(64),
      bindingDigest: "b".repeat(64),
      provider: "claude",
      injectionMethod: "claude-system-prompt",
      qualification: "implementation-supported",
      workspaceProtocol: {
        status: "bound",
        readership: "assignment-only",
        path: "/repo/WORKSPACE_PROTOCOL.md",
        digest: "c".repeat(64),
      },
      createdAt: "2026-08-27T00:00:00.000Z",
    });

    expect(description).toContain(`Policy owner: plugin:slp@sha256:${generationDigest} · 1.0.0`);
  });
});
