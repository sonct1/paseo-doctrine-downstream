import type { TopologyNode } from "@/panels/topology-model";

interface TopologyLayoutEdge {
  source: string;
  target: string;
}

export interface TopologyPosition {
  x: number;
  y: number;
}

const HORIZONTAL_GAP = 360;
const VERTICAL_LANE_GAP = 235;

/**
 * Lay each exact relationship tree out as an X-first sequence. A parent is
 * always placed before its children; sibling Peers therefore extend to the
 * right instead of stacking down the screen. Disconnected trees get their own
 * Y lane so unrelated roots do not overlap.
 */
export function layoutProjectTopologyXFirst(
  nodes: readonly TopologyNode[],
  edges: readonly TopologyLayoutEdge[],
): Map<string, TopologyPosition> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const nodeOrder = new Map(nodes.map((node, index) => [node.id, index]));
  const childrenByParent = new Map<string, string[]>();
  const childIds = new Set<string>();

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    const children = childrenByParent.get(edge.source) ?? [];
    children.push(edge.target);
    childrenByParent.set(edge.source, children);
    childIds.add(edge.target);
  }
  for (const children of childrenByParent.values()) {
    children.sort((left, right) => (nodeOrder.get(left) ?? 0) - (nodeOrder.get(right) ?? 0));
  }

  const positions = new Map<string, TopologyPosition>();
  const placed = new Set<string>();
  let lane = 0;

  const placeTree = (rootId: string) => {
    const orderedIds: string[] = [];
    const visit = (nodeId: string) => {
      if (placed.has(nodeId)) return;
      placed.add(nodeId);
      orderedIds.push(nodeId);
      for (const childId of childrenByParent.get(nodeId) ?? []) visit(childId);
    };
    visit(rootId);
    orderedIds.forEach((nodeId, index) => {
      positions.set(nodeId, { x: index * HORIZONTAL_GAP, y: lane * VERTICAL_LANE_GAP });
    });
    lane += 1;
  };

  for (const node of nodes) {
    if (!childIds.has(node.id)) placeTree(node.id);
  }
  // Cycles are invalid topology, but keep every node visible in a deterministic
  // lane while the warning/receipt layer reports the malformed relationship.
  for (const node of nodes) placeTree(node.id);

  return positions;
}
