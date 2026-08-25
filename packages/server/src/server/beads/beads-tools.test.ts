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

const ASSIGNMENT_DIGEST = "a".repeat(64);
const STALE_ASSIGNMENT_DIGEST = "b".repeat(64);

function assignment(
  effectClass: "read-only" | "mutating" | "delegation" = "mutating",
  external: "denied" | "bounded" = "bounded",
  beadsIssueIds: string[] = ["ps123-abc"],
): PersistedAssignmentContract {
  return {
    receipt: {
      assignmentDigest: ASSIGNMENT_DIGEST,
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
  checkpoint?: "current" | "missing" | "stale";
  statusAvailable?: boolean;
}) {
  const currentAssignment = options.assignment ?? assignment();
  const agent = {
    id: "peer-1",
    workspaceId: "workspace-1",
    roleBinding: {
      roleId: options.roleId,
      assignmentContract: currentAssignment,
    },
    ...(options.checkpoint === "missing"
      ? {}
      : {
          beadsStatusCheckpoint: {
            assignmentDigest:
              options.checkpoint === "stale"
                ? STALE_ASSIGNMENT_DIGEST
                : currentAssignment.receipt.assignmentDigest,
            version: "1.2.0",
            checkedAt: new Date().toISOString(),
          },
        }),
  };
  const issue = {
    id: "ps123-abc",
    title: "Tracked work",
    status: "in_progress" as const,
    priority: 2,
    issue_type: "task" as const,
    assignee: options.assignee,
    description: "Detailed description",
    acceptance_criteria: "Acceptance narrative",
    notes: "n".repeat(20_000),
    labels: ["tracked", "e2e"],
    dependent_count: 2,
    dependency_count: 1,
    comment_count: 3,
  };
  const service = {
    status: vi.fn().mockResolvedValue({
      available: options.statusAvailable ?? true,
      version: "1.2.0",
      ...(options.statusAvailable === false ? { reason: "Central unavailable" } : {}),
    }),
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
  const setBeadsStatusCheckpoint = vi.fn(
    async (_agentId: string, checkpoint: typeof agent.beadsStatusCheckpoint | null) => {
      if (checkpoint) {
        agent.beadsStatusCheckpoint = checkpoint;
      } else {
        delete agent.beadsStatusCheckpoint;
      }
    },
  );
  const tools = new Map<string, CapturedTool>();
  registerBeadsTools({
    registerTool: (name, config, handler) => tools.set(name, { config, handler }),
    service: service as unknown as BeadsService,
    agentStorage: {
      get: vi.fn().mockResolvedValue(agent),
      setBeadsStatusCheckpoint,
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
  return { tools, service, issue, agent, setBeadsStatusCheckpoint };
}

function tool(harness: ReturnType<typeof createHarness>, name: string): CapturedTool {
  const registered = harness.tools.get(name);
  if (!registered) throw new Error(`Missing test tool ${name}`);
  return registered;
}

describe("Beads Central Paseo tools", () => {
  it("rejects every non-status Beads call until status succeeds for the current assignment", async () => {
    const missing = createHarness({
      roleId: "supervisor",
      assignee: null,
      checkpoint: "missing",
    });
    await expect(
      tool(missing, "beads_get").handler({ issueId: "ps123-abc", view: "checkpoint" }, {}),
    ).rejects.toThrow(
      "beads_status must succeed for the current assignment before calling another Beads tool",
    );
    expect(missing.service.get).not.toHaveBeenCalled();

    const stale = createHarness({
      roleId: "supervisor",
      assignee: null,
      checkpoint: "stale",
    });
    await expect(
      tool(stale, "beads_get").handler({ issueId: "ps123-abc", view: "checkpoint" }, {}),
    ).rejects.toThrow("beads_status must succeed for the current assignment");
    expect(stale.service.get).not.toHaveBeenCalled();
  });

  it("records only a successful status receipt and admits later Beads calls", async () => {
    const harness = createHarness({
      roleId: "supervisor",
      assignee: null,
      checkpoint: "missing",
    });

    await expect(tool(harness, "beads_status").handler({}, {})).resolves.toMatchObject({
      structuredContent: { available: true, version: "1.2.0" },
    });
    expect(harness.setBeadsStatusCheckpoint).toHaveBeenNthCalledWith(1, "peer-1", null);
    expect(harness.setBeadsStatusCheckpoint).toHaveBeenNthCalledWith(
      2,
      "peer-1",
      expect.objectContaining({
        assignmentDigest: ASSIGNMENT_DIGEST,
        version: "1.2.0",
      }),
    );
    await expect(
      tool(harness, "beads_get").handler({ issueId: "ps123-abc", view: "checkpoint" }, {}),
    ).resolves.toMatchObject({ structuredContent: { projectId: "project-1" } });
  });

  it("clears admission when status reports Central unavailable", async () => {
    const harness = createHarness({
      roleId: "supervisor",
      assignee: null,
      statusAvailable: false,
    });

    await expect(tool(harness, "beads_status").handler({}, {})).resolves.toMatchObject({
      structuredContent: { available: false, reason: "Central unavailable" },
    });
    expect(harness.setBeadsStatusCheckpoint).toHaveBeenCalledTimes(1);
    await expect(
      tool(harness, "beads_get").handler({ issueId: "ps123-abc", view: "checkpoint" }, {}),
    ).rejects.toThrow("beads_status must succeed for the current assignment");
  });

  it("serializes concurrent status attempts so the latest result owns admission", async () => {
    const harness = createHarness({
      roleId: "supervisor",
      assignee: null,
      checkpoint: "missing",
    });
    let releaseFirst: ((value: { available: true; version: string }) => void) | undefined;
    harness.service.status
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({
        available: false,
        version: "1.2.0",
        reason: "Central unavailable",
      });

    const first = tool(harness, "beads_status").handler({}, {});
    const second = tool(harness, "beads_status").handler({}, {});
    await vi.waitFor(() => expect(harness.service.status).toHaveBeenCalledTimes(1));
    releaseFirst?.({ available: true, version: "1.2.0" });

    await expect(first).resolves.toMatchObject({ structuredContent: { available: true } });
    await expect(second).resolves.toMatchObject({ structuredContent: { available: false } });
    expect(harness.service.status).toHaveBeenCalledTimes(2);
    expect(harness.agent).not.toHaveProperty("beadsStatusCheckpoint");
    await expect(
      tool(harness, "beads_get").handler({ issueId: "ps123-abc", view: "checkpoint" }, {}),
    ).rejects.toThrow("beads_status must succeed for the current assignment");
  });

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

  it("rejects Peer reads and mutations outside exact assignment issue grants", async () => {
    const peer = createHarness({
      roleId: "peer",
      assignment: assignment("mutating", "bounded", ["ps123-other"]),
      assignee: "paseo-agent-peer-1",
    });

    await expect(
      tool(peer, "beads_get").handler({ issueId: "ps123-abc", view: "checkpoint" }, {}),
    ).rejects.toThrow("does not grant Beads issue ps123-abc");
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

  it("allows a read-only Peer to inspect an issue without a mutation grant", async () => {
    const peer = createHarness({
      roleId: "peer",
      assignment: assignment("read-only", "denied"),
      assignee: null,
    });

    await expect(
      tool(peer, "beads_get").handler({ issueId: "ps123-abc", view: "checkpoint" }, {}),
    ).resolves.toMatchObject({
      structuredContent: {
        projectId: "project-1",
        view: "checkpoint",
        issue: { id: "ps123-abc" },
      },
    });
    expect(peer.service.get).toHaveBeenCalledWith(
      { projectId: "project-1", actor: "paseo-agent-peer-1" },
      "ps123-abc",
      undefined,
    );
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

  it("offers a bounded checkpoint view without changing the full issue read", async () => {
    const peer = createHarness({ roleId: "peer", assignee: "paseo-agent-peer-1" });

    const checkpoint = await tool(peer, "beads_get").handler(
      { issueId: "ps123-abc", view: "checkpoint" },
      {},
    );
    expect(checkpoint.structuredContent).toMatchObject({
      projectId: "project-1",
      view: "checkpoint",
      issue: {
        id: "ps123-abc",
        status: "in_progress",
        labelCount: 2,
        dependent_count: 2,
        dependency_count: 1,
        comment_count: 3,
        narrativeOmitted: {
          titleCharacters: 12,
          titleSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          descriptionCharacters: 20,
          descriptionSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          acceptanceCriteriaCharacters: 20,
          acceptanceCriteriaSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          notesCharacters: 20_000,
          notesSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          closeReasonCharacters: 0,
          closeReasonSha256: null,
        },
      },
    });
    expect(JSON.stringify(checkpoint.structuredContent)).not.toContain("n".repeat(1_000));
    expect(JSON.stringify(checkpoint.structuredContent)).not.toContain("Tracked work");
    expect(checkpoint.structuredContent).not.toHaveProperty("issue.title");
    expect(checkpoint.structuredContent).not.toHaveProperty("issue.labels");

    const full = await tool(peer, "beads_get").handler({ issueId: "ps123-abc" }, {});
    expect(full.structuredContent).toMatchObject({
      projectId: "project-1",
      issue: { notes: "n".repeat(20_000) },
    });
  });

  it("removes label values from every role checkpoint", async () => {
    for (const roleId of ["lead", "peer", "supervisor"] as const) {
      const harness = createHarness({
        roleId,
        assignee: roleId === "peer" ? "paseo-agent-peer-1" : null,
      });
      const checkpoint = await tool(harness, "beads_get").handler(
        { issueId: "ps123-abc", view: "checkpoint" },
        {},
      );
      expect(checkpoint.structuredContent).toMatchObject({ issue: { labelCount: 2 } });
      expect(checkpoint.structuredContent).not.toHaveProperty("issue.labels");
      expect(checkpoint.structuredContent).not.toHaveProperty("issue.labelsTruncated");
    }
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
