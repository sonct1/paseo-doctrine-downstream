import { describe, expect, it, vi } from "vitest";

import type { PaseoRoleId } from "@getpaseo/protocol/role-binding";

import type { AgentStorage } from "../agent/agent-storage.js";
import type { PersistedAssignmentContract } from "../agent/assignment-contract.js";
import type {
  PaseoToolConfig,
  PaseoToolExecutionContext,
  PaseoToolResult,
} from "../agent/tools/types.js";
import type { BeadsMutationGuard, BeadsService } from "./beads-service.js";
import { registerBeadsTools } from "./beads-tools.js";

interface CapturedTool {
  config: PaseoToolConfig;
  handler: (input: unknown, context: PaseoToolExecutionContext) => Promise<PaseoToolResult>;
}

function assignment(
  effectClass: "read-only" | "mutating" | "delegation" = "mutating",
  external: "denied" | "bounded" = "bounded",
  beadsIssueIds: string[] = ["ps123-abc"],
): PersistedAssignmentContract {
  return {
    receipt: {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    envelope: {
      effectClass,
      resourceGrants: { beadsIssueIds },
      externalEffectBoundary:
        external === "bounded"
          ? { mode: "bounded", scope: "Beads issue graph for this project" }
          : { mode: "denied" },
    },
  } as PersistedAssignmentContract;
}

function createHarness(options: {
  roleId: PaseoRoleId;
  assignment?: PersistedAssignmentContract;
  assignee?: string | null;
}) {
  const agent = {
    id: "peer-1",
    workspaceId: "workspace-1",
    roleBinding: {
      roleId: options.roleId,
      assignmentContract: options.assignment ?? assignment(),
    },
  };
  const issue = {
    id: "ps123-abc",
    title: "Tracked work",
    status: "in_progress" as const,
    priority: 2,
    issue_type: "task" as const,
    assignee: options.assignee,
  };
  const service = {
    status: vi.fn().mockResolvedValue({ available: true, version: "1.1.2" }),
    ready: vi.fn().mockResolvedValue([issue]),
    list: vi.fn().mockResolvedValue([issue]),
    get: vi.fn().mockResolvedValue(issue),
    create: vi.fn().mockResolvedValue(issue),
    claim: vi.fn().mockResolvedValue({ ...issue, assignee: "paseo-agent-peer-1" }),
    update: vi.fn(
      async (
        _project: unknown,
        _issueId: string,
        _input: unknown,
        _signal: AbortSignal | undefined,
        guard: BeadsMutationGuard | undefined,
      ) => {
        if (guard?.kind === "owned-mutation" && issue.assignee !== guard.actor) {
          throw new Error(`Peer ${guard.actor} may mutate only an issue assigned to itself`);
        }
        return issue;
      },
    ),
    close: vi.fn().mockResolvedValue({ ...issue, status: "closed" }),
    addDependency: vi.fn().mockResolvedValue(issue),
    prime: vi.fn().mockResolvedValue("workflow"),
  };
  const tools = new Map<string, CapturedTool>();
  registerBeadsTools({
    registerTool: (name, config, handler) => tools.set(name, { config, handler }),
    service: service as unknown as BeadsService,
    agentStorage: {
      get: vi.fn().mockResolvedValue(agent),
    } as unknown as AgentStorage,
    workspaceRegistry: {
      get: vi.fn().mockResolvedValue({
        workspaceId: "workspace-1",
        projectId: "project-1",
        archivedAt: null,
      }),
    },
    projectRegistry: {
      get: vi.fn().mockResolvedValue({ projectId: "project-1", archivedAt: null }),
    },
    callerAgentId: "peer-1",
    roleId: options.roleId,
  });
  return { tools, service, issue };
}

function tool(harness: ReturnType<typeof createHarness>, name: string): CapturedTool {
  const registered = harness.tools.get(name);
  if (!registered) throw new Error(`Missing test tool ${name}`);
  return registered;
}

describe("Beads Central Paseo tools", () => {
  it("derives project and actor from the caller instead of accepting client-selected identity", async () => {
    const harness = createHarness({
      roleId: "peer",
      assignee: "paseo-agent-peer-1",
    });

    await tool(harness, "beads_update").handler(
      {
        issueId: "ps123-abc",
        appendNotes: "Evidence",
        idempotencyKey: "update-evidence-1",
      },
      {},
    );

    expect(harness.service.update).toHaveBeenCalledWith(
      { projectId: "project-1", actor: "paseo-agent-peer-1" },
      "ps123-abc",
      { appendNotes: "Evidence", idempotencyKey: "update-evidence-1" },
      undefined,
      {
        kind: "owned-mutation",
        issueId: "ps123-abc",
        actor: "paseo-agent-peer-1",
        requireNotClosed: true,
      },
    );
  });

  it("guards a granted Peer claim before the Central mutation", async () => {
    const harness = createHarness({ roleId: "peer", assignee: null });

    await tool(harness, "beads_claim").handler(
      { issueId: "ps123-abc", idempotencyKey: "claim-granted" },
      {},
    );

    expect(harness.service.claim).toHaveBeenCalledWith(
      { projectId: "project-1", actor: "paseo-agent-peer-1" },
      "ps123-abc",
      "claim-granted",
      undefined,
      {
        kind: "claim",
        issueId: "ps123-abc",
        actor: "paseo-agent-peer-1",
        requireNotClosed: true,
      },
    );
  });

  it("rejects Peer mutation of an issue owned by another actor", async () => {
    const harness = createHarness({ roleId: "peer", assignee: "paseo-agent-other" });

    await expect(
      tool(harness, "beads_update").handler(
        {
          issueId: "ps123-abc",
          status: "blocked",
          idempotencyKey: "block-1",
        },
        {},
      ),
    ).rejects.toThrow("may mutate only an issue assigned to itself");
    expect(harness.service.update).toHaveBeenCalledOnce();
  });

  it("rejects Peer claim and mutation outside exact assignment issue grants", async () => {
    const peer = createHarness({
      roleId: "peer",
      assignment: assignment("mutating", "bounded", ["ps123-other"]),
      assignee: "paseo-agent-peer-1",
    });

    await expect(
      tool(peer, "beads_claim").handler(
        { issueId: "ps123-abc", idempotencyKey: "claim-ungranted" },
        {},
      ),
    ).rejects.toThrow("does not grant Beads issue ps123-abc");
    await expect(
      tool(peer, "beads_update").handler(
        {
          issueId: "ps123-abc",
          appendNotes: "Out of scope",
          idempotencyKey: "update-ungranted",
        },
        {},
      ),
    ).rejects.toThrow("does not grant Beads issue ps123-abc");
    expect(peer.service.claim).not.toHaveBeenCalled();
    expect(peer.service.get).not.toHaveBeenCalled();
    expect(peer.service.update).not.toHaveBeenCalled();
  });

  it("omits binding closure for a Peer and requires discoveries to retain provenance", async () => {
    const peer = createHarness({ roleId: "peer", assignee: "paseo-agent-peer-1" });

    expect(peer.tools.has("beads_close")).toBe(false);
    await expect(
      tool(peer, "beads_create").handler(
        {
          title: "Discovered work",
          issueType: "task",
          priority: 2,
          idempotencyKey: "discover-1",
        },
        {},
      ),
    ).rejects.toThrow("must include discoveredFrom");
    await expect(
      tool(peer, "beads_create").handler(
        {
          title: "Discovered work",
          issueType: "task",
          priority: 2,
          discoveredFrom: "ps123-ungranted",
          idempotencyKey: "discover-ungranted",
        },
        {},
      ),
    ).rejects.toThrow("does not grant Beads issue ps123-ungranted");
    expect(peer.service.create).not.toHaveBeenCalled();
  });

  it("gives a Supervisor only the read-only tracker surface", async () => {
    const supervisor = createHarness({ roleId: "supervisor", assignee: null });

    await expect(
      tool(supervisor, "beads_get").handler({ issueId: "ps123-abc" }, {}),
    ).resolves.toMatchObject({ structuredContent: { projectId: "project-1" } });
    expect(supervisor.tools.has("beads_create")).toBe(false);
    expect(supervisor.tools.has("beads_claim")).toBe(false);
    expect(supervisor.tools.has("beads_update")).toBe(false);
    expect(supervisor.tools.has("beads_close")).toBe(false);
    expect(supervisor.tools.has("beads_add_dependency")).toBe(false);
    expect(supervisor.service.claim).not.toHaveBeenCalled();
  });

  it("fails closed when the assignment denies external effects", async () => {
    const lead = createHarness({
      roleId: "lead",
      assignment: assignment("delegation", "denied"),
      assignee: null,
    });

    await expect(
      tool(lead, "beads_create").handler(
        {
          title: "New issue",
          issueType: "task",
          priority: 2,
          idempotencyKey: "create-1",
        },
        {},
      ),
    ).rejects.toThrow("requires a bounded external-effect assignment");
    expect(lead.service.create).not.toHaveBeenCalled();
  });
});
