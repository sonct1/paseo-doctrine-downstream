import { describe, expect, test } from "vitest";
import type { AgentSnapshotPayload } from "@getpaseo/protocol/messages";
import { toInspectData } from "./inspect.js";

function snapshotWithAssignment(): AgentSnapshotPayload {
  return {
    id: "agent-1",
    provider: "codex",
    cwd: "/repo",
    title: "Inspect receipt",
    status: "idle",
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:01:00.000Z",
    archivedAt: null,
    labels: {},
    pendingPermissions: [],
    roleBinding: {
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
        effectClass: "read-only",
        mutationBoundary: { mode: "no-write" },
        externalEffectBoundary: { mode: "denied" },
        resourceGrants: { beadsIssueIds: ["ps123-abc"] },
        createdAt: "2026-08-08T00:00:00.000Z",
      },
      createdAt: "2026-08-08T00:00:00.000Z",
    },
  } as AgentSnapshotPayload;
}

describe("agent inspect assignment receipt", () => {
  test("projects the immutable secret-safe assignment receipt", () => {
    expect(toInspectData(snapshotWithAssignment()).Assignment).toEqual({
      Version: 1,
      Digest: "d".repeat(64),
      Role: "lead",
      Disposition: "lead-direct",
      Assigner: "human-session",
      WorkspaceId: "workspace-1",
      Cwd: "/repo",
      EffectClass: "read-only",
      MutationBoundary: "no-write",
      ExternalEffectBoundary: "denied",
      BeadsIssueGrants: ["ps123-abc"],
      ProtocolExceptionExpiresAt: null,
      CreatedAt: "2026-08-08T00:00:00.000Z",
      ExpiresAt: null,
    });
  });

  test("keeps legacy snapshots without assignments compatible", () => {
    const snapshot = snapshotWithAssignment();
    if (snapshot.roleBinding) delete snapshot.roleBinding.assignment;
    expect(toInspectData(snapshot).Assignment).toBeNull();
  });
});
