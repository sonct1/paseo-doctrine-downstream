import { Network } from "lucide-react-native";
import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/shallow";
import type { BeadsIssue } from "@getpaseo/protocol/beads/rpc-schemas";
import { useHostFeature } from "@/runtime/host-features";
import { useIssuesQuery } from "@/issues/data";
import { usePaneContext } from "@/panels/pane-context";
import type { PanelDescriptor } from "@/panels/panel-registry";
import { useSessionStore } from "@/stores/session-store";
import { useProjectWorkspaceIds, useWorkspace } from "@/stores/session-store-hooks";
import { buildProjectTopology } from "@/panels/topology-model";

export function useTopologyPanelDescriptor(
  _target: { kind: "topology" },
  context: { serverId: string; workspaceId: string },
): PanelDescriptor {
  const workspace = useWorkspace(context.serverId, context.workspaceId);
  const projectId = workspace?.projectId ?? "";
  const projectWorkspaceIds = useProjectWorkspaceIds(context.serverId, projectId);
  const count = useSessionStore((state) => {
    const agents = state.sessions[context.serverId]?.agents;
    if (!agents) return 0;
    return buildProjectTopology(agents, projectWorkspaceIds).nodes.length;
  });
  return {
    label: "Project topology",
    subtitle: `${count} agent${count === 1 ? "" : "s"}`,
    tooltip: workspace ? `${workspace.projectDisplayName} topology` : "Project topology",
    titleState: "ready",
    icon: Network,
    statusBucket: null,
  };
}

export function useTopologyPanelState() {
  const { serverId, workspaceId, openTab } = usePaneContext();
  const workspace = useWorkspace(serverId, workspaceId);
  const supportsIssues = useHostFeature(serverId, "beadsIssues");
  const projectId = workspace?.projectId ?? "";
  const projectWorkspaceIds = useProjectWorkspaceIds(serverId, projectId);
  const issuesQuery = useIssuesQuery(
    serverId,
    projectId,
    "all",
    supportsIssues && projectId.length > 0,
  );
  const session = useSessionStore(
    useShallow((state) => ({
      agents: state.sessions[serverId]?.agents,
      hydrated: state.sessions[serverId]?.hasHydratedAgents ?? false,
    })),
  );
  const topology = useMemo(
    () => buildProjectTopology(session.agents, projectWorkspaceIds),
    [projectWorkspaceIds, session.agents],
  );
  const issueById = useMemo(
    () =>
      new Map<string, BeadsIssue>(
        (issuesQuery.data?.issues ?? []).map((issue) => [issue.id, issue]),
      ),
    [issuesQuery.data?.issues],
  );
  const grantedIssueCount = useMemo(
    () => new Set(topology.nodes.flatMap((node) => node.issueIds)).size,
    [topology.nodes],
  );
  const openAgent = useCallback(
    (agentId: string) => openTab({ kind: "agent", agentId }),
    [openTab],
  );
  return {
    ...session,
    topology,
    projectName: workspace?.projectDisplayName ?? "Project",
    openAgent,
    issueById,
    grantedIssueCount,
    issuesLoading: issuesQuery.isLoading,
    issuesError: issuesQuery.error,
  };
}
