import { describe, expect, test } from "vitest";

import type { PaseoRoleId } from "@getpaseo/protocol/role-binding";

import type { AgentStorage } from "../agent/agent-storage.js";
import type { PersistedAssignmentContract } from "../agent/assignment-contract.js";
import type {
  PaseoToolConfig,
  PaseoToolExecutionContext,
  PaseoToolResult,
} from "../agent/tools/types.js";
import { createTestLogger } from "../../test-utils/test-logger.js";
import type { PersistedProjectRecord } from "../workspace-registry.js";
import { BeadsCentralService } from "./beads-central-service.js";
import { registerBeadsTools } from "./beads-tools.js";

interface CapturedTool {
  config: PaseoToolConfig;
  handler: (input: unknown, context: PaseoToolExecutionContext) => Promise<PaseoToolResult>;
}

interface IssueResult {
  projectId: string;
  issue: {
    id: string;
    title: string;
    status: string;
    assignee?: string | null;
    notes?: string;
  };
}

const endpoint = process.env.PASEO_BEADS_CENTRAL_E2E_URL?.trim();
const token = process.env.PASEO_BEADS_CENTRAL_E2E_TOKEN?.trim();
const centralDescribe = endpoint && token ? describe : describe.skip;

function project(projectId: string, projectKey: string): PersistedProjectRecord {
  return {
    projectId,
    rootPath: `/tmp/${projectId}`,
    kind: "git",
    displayName: projectId,
    projectKey,
    workGraphId: null,
    customName: null,
    customIconRevision: null,
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
    archivedAt: null,
  };
}

function assignment(
  roleId: PaseoRoleId,
  beadsIssueIds: string[] = [],
): PersistedAssignmentContract {
  return {
    receipt: { expiresAt: new Date(Date.now() + 60_000).toISOString() },
    envelope: {
      effectClass: roleId === "supervisor" ? "read-only" : "mutating",
      resourceGrants: { beadsIssueIds },
      externalEffectBoundary:
        roleId === "supervisor"
          ? { mode: "denied" }
          : { mode: "bounded", scope: "local Beads Central qualification graph" },
    },
  } as PersistedAssignmentContract;
}

function issueResult(result: PaseoToolResult): IssueResult {
  return result.structuredContent as unknown as IssueResult;
}

centralDescribe("Beads Central Product role path", () => {
  test("routes Lead, Peer, and Supervisor tools through Central to real bd", async () => {
    const runKey = `${process.pid}-${Date.now()}`;
    const projects = new Map<string, PersistedProjectRecord>([
      ["project-main", project("project-main", `central-e2e:${runKey}:main`)],
      ["project-other", project("project-other", `central-e2e:${runKey}:other`)],
    ]);
    const projectRegistry = {
      get: async (projectId: string) => projects.get(projectId) ?? null,
      update: async (
        projectId: string,
        updater: (record: PersistedProjectRecord) => PersistedProjectRecord,
      ) => {
        const current = projects.get(projectId);
        if (!current) return null;
        const updated = updater(current);
        projects.set(projectId, updated);
        return updated;
      },
    };
    const service = new BeadsCentralService({
      logger: createTestLogger(),
      getConfig: () => ({ endpoint: endpoint!, credentialRef: "beads-central-e2e" }),
      credentialStore: { readApiKeyForInternalUse: () => token! },
      projectRegistry,
    });

    function roleTools(roleId: PaseoRoleId, agentId: string, beadsIssueIds: string[] = []) {
      const tools = new Map<string, CapturedTool>();
      registerBeadsTools({
        registerTool: (name, config, handler) => tools.set(name, { config, handler }),
        service,
        callerAgentId: agentId,
        agentStorage: {
          get: async () => ({
            id: agentId,
            workspaceId: "workspace-main",
            roleBinding: {
              roleId,
              assignmentContract: assignment(roleId, beadsIssueIds),
            },
          }),
        } as unknown as AgentStorage,
        workspaceRegistry: {
          get: async () => ({
            workspaceId: "workspace-main",
            projectId: "project-main",
            archivedAt: null,
          }),
        },
        projectRegistry,
        roleId,
      });
      return tools;
    }

    async function invoke(
      tools: Map<string, CapturedTool>,
      name: string,
      input: Record<string, unknown>,
    ): Promise<PaseoToolResult> {
      const registered = tools.get(name);
      if (!registered) throw new Error(`Missing qualified tool ${name}`);
      return registered.handler(input, {});
    }

    const lead = roleTools("lead", "lead-central-e2e");
    await expect(invoke(lead, "beads_status", {})).resolves.toMatchObject({
      structuredContent: { available: true, version: "1.2.0" },
    });

    const created = issueResult(
      await invoke(lead, "beads_create", {
        title: "Product Central role canary",
        description: "Lead created durable work through the Product tool boundary.",
        acceptance: "Peer claim/update and Supervisor read succeed; only Lead closes.",
        issueType: "task",
        priority: 1,
        labels: ["qualification"],
        idempotencyKey: "central-e2e-create-0001",
      }),
    );
    const retry = issueResult(
      await invoke(lead, "beads_create", {
        title: "Product Central role canary",
        description: "Lead created durable work through the Product tool boundary.",
        acceptance: "Peer claim/update and Supervisor read succeed; only Lead closes.",
        issueType: "task",
        priority: 1,
        labels: ["qualification"],
        idempotencyKey: "central-e2e-create-0001",
      }),
    );
    expect(retry.issue.id).toBe(created.issue.id);
    expect(projects.get("project-main")?.workGraphId).toMatch(/^pg-[a-f0-9]{32}$/u);

    const peer = roleTools("peer", "peer-central-e2e", [created.issue.id]);
    await expect(invoke(peer, "beads_status", {})).resolves.toMatchObject({
      structuredContent: { available: true, version: "1.2.0" },
    });
    await expect(invoke(peer, "beads_get", { issueId: created.issue.id })).resolves.toMatchObject({
      structuredContent: { issue: { id: created.issue.id } },
    });
    const claimed = issueResult(
      await invoke(peer, "beads_claim", {
        issueId: created.issue.id,
        idempotencyKey: "central-e2e-claim-0001",
      }),
    );
    expect(claimed.issue.assignee).toBe("paseo-agent-peer-central-e2e");

    const updated = issueResult(
      await invoke(peer, "beads_update", {
        issueId: created.issue.id,
        appendNotes: "Peer qualified the current Central and real-bd path.",
        addLabels: ["peer-qualified"],
        idempotencyKey: "central-e2e-update-0001",
      }),
    );
    expect(updated.issue.notes).toContain("Peer qualified");
    expect(peer.has("beads_close")).toBe(false);

    const supervisor = roleTools("supervisor", "supervisor-central-e2e");
    await expect(invoke(supervisor, "beads_status", {})).resolves.toMatchObject({
      structuredContent: { available: true, version: "1.2.0" },
    });
    const observed = issueResult(
      await invoke(supervisor, "beads_get", { issueId: created.issue.id }),
    );
    expect(observed.issue.assignee).toBe("paseo-agent-peer-central-e2e");
    expect(supervisor.has("beads_update")).toBe(false);

    const closed = issueResult(
      await invoke(lead, "beads_close", {
        issueId: created.issue.id,
        reason: "Role-path qualification passed",
        idempotencyKey: "central-e2e-lead-close",
      }),
    );
    expect(closed.issue.status).toBe("closed");
    await expect(
      invoke(peer, "beads_update", {
        issueId: created.issue.id,
        appendNotes: "Must remain closed and unchanged",
        idempotencyKey: "central-e2e-closed-update",
      }),
    ).rejects.toThrow("cannot mutate closed issue");

    await expect(
      service.list(
        { projectId: "project-other", actor: "paseo-agent-supervisor-central-e2e" },
        { limit: 10 },
      ),
    ).resolves.toEqual([]);
    expect(projects.get("project-other")?.workGraphId).toMatch(/^pg-[a-f0-9]{32}$/u);
  }, 60_000);
});
