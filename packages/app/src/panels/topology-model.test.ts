import { describe, expect, it } from "vitest";
import type { Agent } from "@/stores/session-store";
import {
  buildHostTopology,
  buildProjectTopology,
  buildWorkspaceTopology,
} from "@/panels/topology-model";

function agent(input: {
  id: string;
  role?: "lead" | "peer" | "supervisor";
  launchRole?: "lead" | "peer" | "supervisor";
  parentAgentId?: string | null;
  workspaceId?: string;
  archived?: boolean;
  issueIds?: string[];
  assignerId?: string;
}): Agent {
  return {
    id: input.id,
    title: input.id,
    provider: "mock",
    model: "mock-model",
    status: "idle",
    workspaceId: input.workspaceId ?? "workspace-1",
    parentAgentId: input.parentAgentId ?? null,
    roleBinding: input.role
      ? ({
          roleId: input.role,
          assignment: {
            assigner: input.assignerId
              ? { kind: "agent", agentId: input.assignerId }
              : { kind: "human-session" },
            resourceGrants: input.issueIds?.length ? { beadsIssueIds: input.issueIds } : undefined,
          },
        } as unknown as Agent["roleBinding"])
      : undefined,
    launchContract: input.launchRole
      ? ({ roleId: input.launchRole } as Agent["launchContract"])
      : undefined,
    archivedAt: input.archived ? new Date("2026-08-09T00:00:00.000Z") : null,
    requiresAttention: false,
    createdAt: new Date(`2026-08-09T00:00:0${input.id.length}.000Z`),
    labels: {},
  } as Agent;
}

function agentMap(...agents: Agent[]) {
  return new Map(agents.map((entry) => [entry.id, entry]));
}

describe("buildWorkspaceTopology", () => {
  it("draws exact Supervisor to Lead supervision and Lead to Peer delegation", () => {
    const topology = buildWorkspaceTopology(
      agentMap(
        agent({ id: "supervisor", role: "supervisor" }),
        agent({ id: "lead", role: "lead", parentAgentId: "supervisor" }),
        agent({ id: "peer", role: "peer", parentAgentId: "lead" }),
      ),
      "workspace-1",
    );

    expect(topology.edges).toEqual([
      {
        id: "supervision:supervisor:lead",
        source: "supervisor",
        target: "lead",
        kind: "supervision",
        provenance: "exact",
      },
      {
        id: "delegation:lead:peer",
        source: "lead",
        target: "peer",
        kind: "delegation",
        provenance: "exact",
      },
    ]);
    expect(topology.warnings).toEqual([]);
  });

  it("uses the immutable launch receipt when an older role binding projection is absent", () => {
    const topology = buildWorkspaceTopology(
      agentMap(agent({ id: "supervisor", launchRole: "supervisor" })),
      "workspace-1",
    );

    expect(topology.nodes[0]?.role).toBe("supervisor");
    expect(topology.counts).toEqual({ lead: 0, peer: 0, supervisor: 1, unbound: 0 });
  });

  it("uses the immutable assignment assigner when legacy storage omitted parentAgentId", () => {
    const topology = buildWorkspaceTopology(
      agentMap(
        agent({ id: "supervisor", role: "supervisor" }),
        agent({ id: "lead", role: "lead", assignerId: "supervisor" }),
      ),
      "workspace-1",
    );

    expect(topology.edges).toEqual([
      {
        id: "supervision:supervisor:lead",
        source: "supervisor",
        target: "lead",
        kind: "supervision",
        provenance: "exact",
      },
    ]);
    expect(topology.warnings).toEqual([]);
  });

  it("does not invent relationships between independently launched roles", () => {
    const topology = buildWorkspaceTopology(
      agentMap(
        agent({ id: "supervisor", role: "supervisor" }),
        agent({ id: "lead-a", role: "lead" }),
        agent({ id: "lead-b", role: "lead" }),
      ),
      "workspace-1",
    );

    expect(topology.edges).toEqual([]);
    expect(topology.warnings).toEqual([]);
  });

  it("shows exact cross-workspace ancestors while keeping missing parents as warnings", () => {
    const topology = buildWorkspaceTopology(
      agentMap(
        agent({ id: "peer-a", role: "peer", parentAgentId: "missing" }),
        agent({ id: "lead-other", role: "lead", workspaceId: "workspace-2" }),
        agent({ id: "peer-b", role: "peer", parentAgentId: "lead-other" }),
      ),
      "workspace-1",
    );

    expect(topology.nodes.map((node) => node.id)).toEqual(["lead-other", "peer-a", "peer-b"]);
    expect(topology.edges).toEqual([
      {
        id: "delegation:lead-other:peer-b",
        source: "lead-other",
        target: "peer-b",
        kind: "delegation",
        provenance: "exact",
      },
    ]);
    expect(topology.warnings).toEqual([{ code: "missing_parent", agentId: "peer-a" }]);
  });

  it("expands a control-workspace Supervisor through Leads into project Peers", () => {
    const topology = buildWorkspaceTopology(
      agentMap(
        agent({ id: "supervisor", role: "supervisor", workspaceId: "control" }),
        agent({
          id: "lead-a",
          role: "lead",
          parentAgentId: "supervisor",
          workspaceId: "project-a",
        }),
        agent({ id: "peer-a", role: "peer", parentAgentId: "lead-a", workspaceId: "project-a" }),
        agent({
          id: "lead-b",
          role: "lead",
          parentAgentId: "supervisor",
          workspaceId: "project-b",
        }),
      ),
      "control",
    );

    expect(topology.nodes.map((node) => node.id).sort()).toEqual([
      "lead-a",
      "lead-b",
      "peer-a",
      "supervisor",
    ]);
    expect(topology.edges).toHaveLength(3);
    expect(topology.edges.every((edge) => edge.provenance === "exact")).toBe(true);
  });

  it("excludes archived agents from the live topology", () => {
    const topology = buildWorkspaceTopology(
      agentMap(agent({ id: "lead", role: "lead", archived: true })),
      "workspace-1",
    );
    expect(topology).toEqual({
      nodes: [],
      edges: [],
      warnings: [],
      counts: { lead: 0, peer: 0, supervisor: 0, unbound: 0 },
    });
  });

  it("projects exact Beads issue grants onto the owning agent node", () => {
    const topology = buildWorkspaceTopology(
      agentMap(
        agent({
          id: "peer",
          role: "peer",
          issueIds: ["ps-issue-b", "ps-issue-a", "ps-issue-a"],
        }),
      ),
      "workspace-1",
    );

    expect(topology.nodes[0]?.issueIds).toEqual(["ps-issue-a", "ps-issue-b"]);
  });
});

describe("buildProjectTopology", () => {
  it("aggregates every workspace in one project without pulling sibling projects", () => {
    const topology = buildProjectTopology(
      agentMap(
        agent({ id: "supervisor", role: "supervisor", workspaceId: "workspace-main" }),
        agent({
          id: "lead-main",
          role: "lead",
          assignerId: "supervisor",
          workspaceId: "workspace-main",
        }),
        agent({
          id: "peer-worktree",
          role: "peer",
          parentAgentId: "lead-main",
          workspaceId: "workspace-worktree",
        }),
        agent({
          id: "lead-sibling-project",
          role: "lead",
          assignerId: "supervisor",
          workspaceId: "workspace-other-project",
        }),
      ),
      ["workspace-main", "workspace-worktree"],
    );

    expect(topology.nodes.map((node) => node.id)).toEqual([
      "lead-main",
      "peer-worktree",
      "supervisor",
    ]);
    expect(topology.edges.map((edge) => edge.kind)).toEqual(["supervision", "delegation"]);
  });
});

describe("buildHostTopology", () => {
  it("aggregates exact role relationships across project workspaces", () => {
    const topology = buildHostTopology(
      agentMap(
        agent({ id: "supervisor", role: "supervisor", workspaceId: "control" }),
        agent({ id: "lead", role: "lead", parentAgentId: "supervisor", workspaceId: "project" }),
        agent({ id: "peer", role: "peer", parentAgentId: "lead", workspaceId: "project" }),
        agent({ id: "legacy", workspaceId: "project" }),
      ),
    );

    expect(topology.nodes.map((node) => node.id)).toEqual(["lead", "peer", "legacy", "supervisor"]);
    expect(topology.edges.map((edge) => edge.kind)).toEqual(["supervision", "delegation"]);
    expect(topology.counts).toEqual({ lead: 1, peer: 1, supervisor: 1, unbound: 1 });
  });
});
