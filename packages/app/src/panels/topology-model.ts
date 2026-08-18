import type { PaseoRoleId } from "@getpaseo/protocol/role-binding";
import type { Agent } from "@/stores/session-store";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";

export type TopologyRole = PaseoRoleId | "unbound";
export type TopologyEdgeKind = "delegation" | "supervision";

export interface TopologyNode {
  id: string;
  title: string;
  shortId: string;
  role: TopologyRole;
  status: Agent["status"];
  provider: string;
  model: string | null;
  workspaceId: string | null;
  requiresAttention: boolean;
  issueIds: string[];
}

export interface TopologyEdge {
  id: string;
  source: string;
  target: string;
  kind: TopologyEdgeKind;
  provenance: "exact" | "inferred";
}

export type TopologyWarningCode =
  | "ambiguous_lead"
  | "ambiguous_supervisor"
  | "missing_parent"
  | "role_mismatch";

export interface TopologyWarning {
  code: TopologyWarningCode;
  agentId?: string;
}

export interface WorkspaceTopology {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  warnings: TopologyWarning[];
  counts: Record<TopologyRole, number>;
}

function roleOf(agent: Agent): TopologyRole {
  return agent.roleBinding?.roleId ?? agent.launchContract?.roleId ?? "unbound";
}

function titleOf(agent: Agent): string {
  const title = agent.title?.trim();
  return (
    title || `${roleOf(agent) === "unbound" ? "Agent" : roleOf(agent)} ${agent.id.slice(0, 8)}`
  );
}

function issueIdsOf(agent: Agent): string[] {
  const issueIds = agent.roleBinding?.assignment?.resourceGrants?.beadsIssueIds;
  return [...new Set(issueIds ?? [])].sort();
}

function assignmentParentAgentIdOf(agent: Agent): string | null {
  const roleBindingAssigner = agent.roleBinding?.assignment?.assigner;
  return roleBindingAssigner?.kind === "agent" ? roleBindingAssigner.agentId : null;
}

function parentAgentIdOf(agent: Agent): string | null {
  return agent.parentAgentId ?? assignmentParentAgentIdOf(agent);
}

function selectTopologyAgentIds(
  activeAgents: readonly Agent[],
  seedAgentIds: readonly string[],
  includeDescendants = true,
): Set<string> {
  const activeById = new Map(activeAgents.map((agent) => [agent.id, agent]));
  const selectedIds = new Set(seedAgentIds);

  for (const seedId of seedAgentIds) {
    let current = activeById.get(seedId);
    const visited = new Set<string>();
    let parentAgentId = current ? parentAgentIdOf(current) : null;
    while (parentAgentId && !visited.has(parentAgentId)) {
      visited.add(parentAgentId);
      const parent = activeById.get(parentAgentId);
      if (!parent) break;
      selectedIds.add(parent.id);
      current = parent;
      parentAgentId = parentAgentIdOf(current);
    }
  }

  if (!includeDescendants) return selectedIds;

  const descendantQueue = [...seedAgentIds];
  for (let index = 0; index < descendantQueue.length; index += 1) {
    const parentId = descendantQueue[index];
    for (const candidate of activeAgents) {
      if (parentAgentIdOf(candidate) !== parentId || selectedIds.has(candidate.id)) continue;
      selectedIds.add(candidate.id);
      descendantQueue.push(candidate.id);
    }
  }
  return selectedIds;
}

export function buildWorkspaceTopology(
  agents: ReadonlyMap<string, Agent> | undefined,
  workspaceId: string,
): WorkspaceTopology {
  const normalizedWorkspaceId = normalizeWorkspaceOpaqueId(workspaceId);
  const activeAgents = [...(agents?.values() ?? [])].filter((agent) => !agent.archivedAt);
  const workspaceSeedIds = activeAgents
    .filter((agent) => normalizeWorkspaceOpaqueId(agent.workspaceId) === normalizedWorkspaceId)
    .map((agent) => agent.id);
  const selectedIds = selectTopologyAgentIds(activeAgents, workspaceSeedIds);

  const workspaceAgents = activeAgents
    .filter((agent) => selectedIds.has(agent.id))
    .sort(
      (left, right) =>
        left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id),
    );

  return buildTopology(workspaceAgents);
}

export function buildProjectTopology(
  agents: ReadonlyMap<string, Agent> | undefined,
  workspaceIds: readonly string[],
): WorkspaceTopology {
  const normalizedWorkspaceIds = new Set(
    workspaceIds.map(normalizeWorkspaceOpaqueId).filter((id): id is string => id !== null),
  );
  const activeAgents = [...(agents?.values() ?? [])].filter((agent) => !agent.archivedAt);
  const projectSeedIds = activeAgents
    .filter((agent) =>
      normalizedWorkspaceIds.has(normalizeWorkspaceOpaqueId(agent.workspaceId) ?? ""),
    )
    .map((agent) => agent.id);
  const selectedIds = selectTopologyAgentIds(activeAgents, projectSeedIds, false);
  const projectAgents = activeAgents
    .filter((agent) => selectedIds.has(agent.id))
    .sort(
      (left, right) =>
        left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id),
    );
  return buildTopology(projectAgents);
}

export function buildHostTopology(
  agents: ReadonlyMap<string, Agent> | undefined,
): WorkspaceTopology {
  const activeAgents = [...(agents?.values() ?? [])]
    .filter((agent) => !agent.archivedAt)
    .sort(
      (left, right) =>
        left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id),
    );
  return buildTopology(activeAgents);
}

function buildTopology(topologyAgents: readonly Agent[]): WorkspaceTopology {
  const nodes = topologyAgents.map<TopologyNode>((agent) => ({
    id: agent.id,
    title: titleOf(agent),
    shortId: agent.id.slice(0, 8),
    role: roleOf(agent),
    status: agent.status,
    provider: agent.provider,
    model: agent.model,
    workspaceId: agent.workspaceId ?? null,
    requiresAttention: agent.requiresAttention ?? false,
    issueIds: issueIdsOf(agent),
  }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const sourceById = new Map(topologyAgents.map((agent) => [agent.id, agent]));
  const edges: TopologyEdge[] = [];
  const warnings: TopologyWarning[] = [];

  for (const agent of topologyAgents) {
    const parentAgentId = parentAgentIdOf(agent);
    if (!parentAgentId) continue;
    const parent = sourceById.get(parentAgentId);
    if (!parent || !nodeById.has(parent.id)) {
      warnings.push({ code: "missing_parent", agentId: agent.id });
      continue;
    }
    const isSupervision = roleOf(parent) === "supervisor" && roleOf(agent) === "lead";
    const isDelegation = roleOf(parent) === "lead" && roleOf(agent) === "peer";
    const kind: TopologyEdgeKind = isSupervision ? "supervision" : "delegation";
    edges.push({
      id: `${kind}:${parent.id}:${agent.id}`,
      source: parent.id,
      target: agent.id,
      kind,
      provenance: "exact",
    });
    if (!isSupervision && !isDelegation) {
      warnings.push({ code: "role_mismatch", agentId: agent.id });
    }
  }

  const counts: Record<TopologyRole, number> = {
    lead: 0,
    peer: 0,
    supervisor: 0,
    unbound: 0,
  };
  for (const node of nodes) counts[node.role] += 1;
  return { nodes, edges, warnings, counts };
}
