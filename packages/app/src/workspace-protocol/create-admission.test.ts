import { describe, expect, test, vi } from "vitest";
import {
  requireWorkspaceProtocolForRole,
  WorkspaceProtocolCreateAdmissionError,
} from "./create-admission";

function snapshot(status: "missing" | "valid" | "invalid" | "unreadable") {
  const common = {
    repoRoot: "/repo/worktree",
    path: "/repo/worktree/WORKSPACE_PROTOCOL.md",
    issues: [],
  };
  if (status === "missing") {
    return { status, ...common, suggestedContent: "preview", revision: null } as const;
  }
  if (status === "unreadable") {
    return { status, ...common, revision: null } as const;
  }
  return {
    status,
    ...common,
    content: "protocol",
    revision: { mtimeMs: 1, size: 8, sha256: "a".repeat(64) },
  } as const;
}

const baseInput = {
  serverId: "host-a",
  projectId: "project-a",
  repoRoot: "/repo/worktree",
  roleId: "lead" as const,
  effectClass: "mutating" as const,
  supported: true,
};

describe("role create Workspace Protocol admission", () => {
  test("does not inspect an unbound create", async () => {
    const client = { inspectWorkspaceProtocol: vi.fn() };
    await requireWorkspaceProtocolForRole({ ...baseInput, client, roleId: null });
    expect(client.inspectWorkspaceProtocol).not.toHaveBeenCalled();
  });

  test("admits only a valid protocol at the exact workspace root", async () => {
    const client = {
      inspectWorkspaceProtocol: vi.fn(async () => ({
        requestId: "inspect-1",
        ok: true as const,
        snapshot: snapshot("valid"),
      })),
    };
    await requireWorkspaceProtocolForRole({ ...baseInput, client });
    expect(client.inspectWorkspaceProtocol).toHaveBeenCalledWith("/repo/worktree");
  });

  test.each(["missing", "invalid", "unreadable"] as const)(
    "routes %s admission failures to project settings",
    async (status) => {
      const client = {
        inspectWorkspaceProtocol: vi.fn(async () => ({
          requestId: "inspect-1",
          ok: true as const,
          snapshot: snapshot(status),
        })),
      };

      const failure = await requireWorkspaceProtocolForRole({ ...baseInput, client }).catch(
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(WorkspaceProtocolCreateAdmissionError);
      expect(failure).toMatchObject({
        kind: status,
        projectSettingsRoute:
          "/settings/hosts/host-a/projects/project-a?protocolRoot=%2Frepo%2Fworktree",
      });
    },
  );

  test("returns a bounded Human exception for explicit read-only work on a missing protocol", async () => {
    const client = {
      inspectWorkspaceProtocol: vi.fn(async () => ({
        requestId: "inspect-1",
        ok: true as const,
        snapshot: snapshot("missing"),
      })),
    };

    await expect(
      requireWorkspaceProtocolForRole({
        ...baseInput,
        client,
        effectClass: "read-only",
        now: new Date("2026-08-08T00:00:00.000Z"),
      }),
    ).resolves.toEqual({
      reason: "read-only work while the repository protocol is being bootstrapped",
      scope: "/repo/worktree",
      expiresAt: "2026-08-08T00:30:00.000Z",
    });
  });

  test("fails closed when the host capability or inspection is unavailable", async () => {
    const client = {
      inspectWorkspaceProtocol: vi.fn(async () => Promise.reject(new Error("down"))),
    };

    await expect(
      requireWorkspaceProtocolForRole({ ...baseInput, client, supported: false }),
    ).rejects.toMatchObject({ kind: "unsupported" });
    expect(client.inspectWorkspaceProtocol).not.toHaveBeenCalled();

    await expect(requireWorkspaceProtocolForRole({ ...baseInput, client })).rejects.toMatchObject({
      kind: "inspection_failed",
    });
  });
});
