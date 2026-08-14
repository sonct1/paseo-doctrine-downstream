import { describe, expect, it } from "vitest";
import type { Agent } from "@/stores/session-store";
import { buildWorkspaceTopology } from "@/panels/topology-model";

function agent(input: {
  id: string;
  role?: "lead" | "peer" | "supervisor";
  parentAgentId?: string | null;
  workspaceId?: string;
  archived?: boolean;
  issueIds?: string[];
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
            resourceGrants: input.issueIds?.length ? { beadsIssueIds: input.issueIds } : undefined,
          },
        } as unknown as Agent["roleBinding"])
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
  it("draws exact Lead to Peer delegation and inferred Supervisor observation separately", () => {
    const topology = buildWorkspaceTopology(
      agentMap(
        agent({ id: "supervisor", role: "supervisor" }),
        agent({ id: "lead", role: "lead" }),
        agent({ id: "peer", role: "peer", parentAgentId: "lead" }),
      ),
      "workspace-1",
    );

    expect(topology.edges).toEqual([
      {
        id: "delegation:lead:peer",
        source: "lead",
        target: "peer",
        kind: "delegation",
        provenance: "exact",
      },
      {
        id: "observation:supervisor:lead",
        source: "supervisor",
        target: "lead",
        kind: "observation",
        provenance: "inferred",
      },
    ]);
    expect(topology.warnings).toEqual([]);
  });

  it("does not invent a Supervisor edge when Lead ownership is ambiguous", () => {
    const topology = buildWorkspaceTopology(
      agentMap(
        agent({ id: "supervisor", role: "supervisor" }),
        agent({ id: "lead-a", role: "lead" }),
        agent({ id: "lead-b", role: "lead" }),
      ),
      "workspace-1",
    );

    expect(topology.edges).toEqual([]);
    expect(topology.warnings).toEqual([{ code: "ambiguous_lead" }]);
  });

  it("keeps missing and cross-workspace parents visible as warnings without drawing edges", () => {
    const topology = buildWorkspaceTopology(
      agentMap(
        agent({ id: "peer-a", role: "peer", parentAgentId: "missing" }),
        agent({ id: "lead-other", role: "lead", workspaceId: "workspace-2" }),
        agent({ id: "peer-b", role: "peer", parentAgentId: "lead-other" }),
      ),
      "workspace-1",
    );

    expect(topology.nodes.map((node) => node.id)).toEqual(["peer-a", "peer-b"]);
    expect(topology.edges).toEqual([]);
    expect(topology.warnings).toEqual([
      { code: "missing_parent", agentId: "peer-a" },
      { code: "missing_parent", agentId: "peer-b" },
    ]);
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
