import { describe, expect, it, vi } from "vitest";
import type { BeadsIssue } from "@getpaseo/protocol/beads/rpc-schemas";
import type { PersistedRoleBinding } from "../agent/role-binding.js";
import { createMutatingPeerGrantVerifier } from "./beads-grant-verifier.js";

function roleBinding(effectClass: "read-only" | "mutating"): PersistedRoleBinding {
  return {
    roleId: "peer",
    assignmentContract: {
      receipt: { workspaceId: "workspace-1" },
      envelope: {
        effectClass,
        resourceGrants: effectClass === "mutating" ? { beadsIssueIds: ["ps123-abc"] } : undefined,
      },
    },
  } as PersistedRoleBinding;
}

function issue(overrides: Partial<BeadsIssue> = {}): BeadsIssue {
  return {
    id: "ps123-abc",
    title: "Granted work",
    status: "open",
    priority: 2,
    issue_type: "task",
    assignee: null,
    ...overrides,
  } as BeadsIssue;
}

describe("mutating Peer Beads grant verifier", () => {
  it("does not consult Central for a read-only Peer", async () => {
    const status = vi.fn();
    const get = vi.fn();
    const verify = createMutatingPeerGrantVerifier({
      service: { status, get },
      workspaceRegistry: { get: vi.fn() },
    });

    await expect(
      verify({ agentId: "peer-agent", roleBinding: roleBinding("read-only") }),
    ).resolves.toBeUndefined();
    expect(status).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it("fails closed before issue lookup when Central is unavailable", async () => {
    const get = vi.fn();
    const verify = createMutatingPeerGrantVerifier({
      service: {
        status: vi.fn().mockResolvedValue({
          available: false,
          version: "1.2.0",
          reason: "Central unavailable",
        }),
        get,
      },
      workspaceRegistry: {
        get: vi.fn().mockResolvedValue({
          workspaceId: "workspace-1",
          projectId: "project-1",
          archivedAt: null,
        }),
      },
    });

    await expect(
      verify({ agentId: "peer-agent", roleBinding: roleBinding("mutating") }),
    ).rejects.toThrow("Central unavailable");
    expect(get).not.toHaveBeenCalled();
  });

  it("authoritatively reads the granted open issue in the bound project", async () => {
    const get = vi.fn().mockResolvedValue(issue());
    const verify = createMutatingPeerGrantVerifier({
      service: {
        status: vi.fn().mockResolvedValue({ available: true, version: "1.2.0" }),
        get,
      },
      workspaceRegistry: {
        get: vi.fn().mockResolvedValue({
          workspaceId: "workspace-1",
          projectId: "project-1",
          archivedAt: null,
        }),
      },
    });

    await expect(
      verify({ agentId: "Peer Agent", roleBinding: roleBinding("mutating") }),
    ).resolves.toBeUndefined();
    expect(get).toHaveBeenCalledWith(
      { projectId: "project-1", actor: "paseo-agent-peer-agent" },
      "ps123-abc",
    );
  });

  it("rejects a closed or mismatched issue receipt", async () => {
    for (const returned of [issue({ status: "closed" }), issue({ id: "ps999-other" })]) {
      const verify = createMutatingPeerGrantVerifier({
        service: {
          status: vi.fn().mockResolvedValue({ available: true, version: "1.2.0" }),
          get: vi.fn().mockResolvedValue(returned),
        },
        workspaceRegistry: {
          get: vi.fn().mockResolvedValue({
            workspaceId: "workspace-1",
            projectId: "project-1",
            archivedAt: null,
          }),
        },
      });
      await expect(
        verify({ agentId: "peer-agent", roleBinding: roleBinding("mutating") }),
      ).rejects.toThrow("beads_issue_grant_verification_failed");
    }
  });
});
