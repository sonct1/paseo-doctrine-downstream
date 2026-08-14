import type { PaseoRoleId } from "@getpaseo/protocol/role-binding";
import type { Agent } from "@/stores/session-store";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";

export type TopologyRole = PaseoRoleId | "unbound";
export type TopologyEdgeKind = "delegation" | "observation";

export interface TopologyNode {
  id: string;
  title: string;
  shortId: string;
  role: TopologyRole;
  status: Agent["status"];
  provider: string;
  model: string | null;
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
  return agent.roleBinding?.roleId ?? "unbound";
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

export function buildWorkspaceTopology(
  agents: ReadonlyMap<string, Agent> | undefined,
  workspaceId: string,
): WorkspaceTopology {
  const normalizedWorkspaceId = normalizeWorkspaceOpaqueId(workspaceId);
  const workspaceAgents = [...(agents?.values() ?? [])]
    .filter(
      (agent) =>
        !agent.archivedAt &&
        normalizeWorkspaceOpaqueId(agent.workspaceId) === normalizedWorkspaceId,
    )
    .sort(
      (left, right) =>
        left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id),
    );

  const nodes = workspaceAgents.map<TopologyNode>((agent) => ({
    id: agent.id,
    title: titleOf(agent),
    shortId: agent.id.slice(0, 8),
    role: roleOf(agent),
    status: agent.status,
    provider: agent.provider,
    model: agent.model,
    requiresAttention: agent.requiresAttention ?? false,
    issueIds: issueIdsOf(agent),
  }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const sourceById = new Map(workspaceAgents.map((agent) => [agent.id, agent]));
  const edges: TopologyEdge[] = [];
  const warnings: TopologyWarning[] = [];

  for (const agent of workspaceAgents) {
    if (!agent.parentAgentId) continue;
    const parent = sourceById.get(agent.parentAgentId);
    if (!parent || !nodeById.has(parent.id)) {
      warnings.push({ code: "missing_parent", agentId: agent.id });
      continue;
    }
    edges.push({
      id: `delegation:${parent.id}:${agent.id}`,
      source: parent.id,
      target: agent.id,
      kind: "delegation",
      provenance: "exact",
    });
    if (roleOf(parent) !== "lead" || roleOf(agent) !== "peer") {
      warnings.push({ code: "role_mismatch", agentId: agent.id });
    }
  }

  const leads = nodes.filter((node) => node.role === "lead");
  const supervisors = nodes.filter((node) => node.role === "supervisor");
  if (leads.length > 1) warnings.push({ code: "ambiguous_lead" });
  if (supervisors.length > 1) warnings.push({ code: "ambiguous_supervisor" });
  if (leads.length === 1 && supervisors.length === 1) {
    edges.push({
      id: `observation:${supervisors[0].id}:${leads[0].id}`,
      source: supervisors[0].id,
      target: leads[0].id,
      kind: "observation",
      provenance: "inferred",
    });
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
