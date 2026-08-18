import { describe, expect, it } from "vitest";
import type { TopologyNode } from "@/panels/topology-model";
import { layoutProjectTopologyXFirst } from "@/panels/topology-layout";

function roleFromId(id: string): TopologyNode["role"] {
  if (id.startsWith("peer")) return "peer";
  if (id.startsWith("supervisor")) return "supervisor";
  return "lead";
}

function node(id: string): TopologyNode {
  return {
    id,
    title: id,
    shortId: id,
    role: roleFromId(id),
    status: "idle",
    provider: "codex",
    model: "test-model",
    workspaceId: "workspace-1",
    requiresAttention: false,
    issueIds: [],
  };
}

describe("layoutProjectTopologyXFirst", () => {
  it("places a Lead and every direct Peer on one horizontal lane", () => {
    const nodes = [node("lead"), node("peer-1"), node("peer-2"), node("peer-3")];
    const positions = layoutProjectTopologyXFirst(nodes, [
      { source: "lead", target: "peer-1" },
      { source: "lead", target: "peer-2" },
      { source: "lead", target: "peer-3" },
    ]);

    expect(nodes.map((entry) => positions.get(entry.id)?.y)).toEqual([0, 0, 0, 0]);
    expect(nodes.map((entry) => positions.get(entry.id)?.x)).toEqual([0, 360, 720, 1080]);
  });

  it("keeps Supervisor, Lead and Peer ordered from left to right", () => {
    const positions = layoutProjectTopologyXFirst(
      [node("supervisor"), node("lead"), node("peer-1")],
      [
        { source: "supervisor", target: "lead" },
        { source: "lead", target: "peer-1" },
      ],
    );

    expect(positions.get("supervisor")?.x).toBeLessThan(positions.get("lead")?.x ?? 0);
    expect(positions.get("lead")?.x).toBeLessThan(positions.get("peer-1")?.x ?? 0);
  });

  it("uses Y only to separate disconnected relationship trees", () => {
    const positions = layoutProjectTopologyXFirst(
      [node("lead-a"), node("peer-a"), node("lead-b"), node("peer-b")],
      [
        { source: "lead-a", target: "peer-a" },
        { source: "lead-b", target: "peer-b" },
      ],
    );

    expect(positions.get("lead-a")?.y).toBe(positions.get("peer-a")?.y);
    expect(positions.get("lead-b")?.y).toBe(positions.get("peer-b")?.y);
    expect(positions.get("lead-a")?.y).not.toBe(positions.get("lead-b")?.y);
  });
});
