import { Network } from "lucide-react-native";
import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/shallow";
import { usePaneContext } from "@/panels/pane-context";
import type { PanelDescriptor } from "@/panels/panel-registry";
import { useSessionStore } from "@/stores/session-store";
import { buildWorkspaceTopology } from "@/panels/topology-model";

export function useTopologyPanelDescriptor(
  _target: { kind: "topology" },
  context: { serverId: string; workspaceId: string },
): PanelDescriptor {
  const count = useSessionStore((state) => {
    const agents = state.sessions[context.serverId]?.agents;
    if (!agents) return 0;
    return buildWorkspaceTopology(agents, context.workspaceId).nodes.length;
  });
  return {
    label: "Topology",
    subtitle: `${count} agent${count === 1 ? "" : "s"}`,
    tooltip: "Workspace topology",
    titleState: "ready",
    icon: Network,
    statusBucket: null,
  };
}

export function useTopologyPanelState() {
  const { serverId, workspaceId, openTab } = usePaneContext();
  const session = useSessionStore(
    useShallow((state) => ({
      agents: state.sessions[serverId]?.agents,
      hydrated: state.sessions[serverId]?.hasHydratedAgents ?? false,
    })),
  );
  const topology = useMemo(
    () => buildWorkspaceTopology(session.agents, workspaceId),
    [session.agents, workspaceId],
  );
  const openAgent = useCallback(
    (agentId: string) => openTab({ kind: "agent", agentId }),
    [openTab],
  );
  return { ...session, topology, openAgent };
}
