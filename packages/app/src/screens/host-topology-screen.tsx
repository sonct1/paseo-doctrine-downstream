import { useCallback, useMemo } from "react";
import { router } from "expo-router";
import { Network } from "lucide-react-native";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { buildHostTopology, type TopologyEdge, type TopologyNode } from "@/panels/topology-model";
import { useSessionStore } from "@/stores/session-store";
import { buildHostAgentDetailRoute } from "@/utils/host-routes";

const ROLE_ORDER = ["supervisor", "lead", "peer", "unbound"] as const;
interface ProjectGroup {
  label: string;
  nodes: TopologyNode[];
}

function agentCardStyle({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.agentCard, (hovered || pressed) && styles.agentCardActive];
}

function TopologyAgentCard({
  serverId,
  node,
  edge,
  parent,
}: {
  serverId: string;
  node: TopologyNode;
  edge: TopologyEdge | undefined;
  parent: TopologyNode | undefined;
}) {
  const handlePress = useCallback(() => {
    router.push(buildHostAgentDetailRoute(serverId, node.id, node.workspaceId ?? undefined));
  }, [node.id, node.workspaceId, serverId]);
  return (
    <Pressable
      onPress={handlePress}
      style={agentCardStyle}
      testID={`host-topology-agent-${node.id}`}
    >
      <View style={styles.agentHeading}>
        <Text style={styles.agentTitle} numberOfLines={1}>
          {node.title}
        </Text>
        <View style={[styles.statusDot, styles[`status_${node.status}`]]} />
      </View>
      <Text style={styles.agentMeta} numberOfLines={1}>
        {node.provider}/{node.model ?? "default"}
      </Text>
      {parent && edge ? (
        <Text style={styles.relation} numberOfLines={1}>
          {edge.kind === "supervision" ? "supervised" : "delegated"} by {parent.title}
        </Text>
      ) : null}
    </Pressable>
  );
}

function ProjectTopologySection({
  serverId,
  group,
  parentByChild,
  nodeById,
}: {
  serverId: string;
  group: ProjectGroup;
  parentByChild: ReadonlyMap<string, TopologyEdge>;
  nodeById: ReadonlyMap<string, TopologyNode>;
}) {
  return (
    <View style={styles.projectSection}>
      <Text style={styles.projectTitle}>{group.label}</Text>
      <View style={styles.roleGrid}>
        {ROLE_ORDER.map((role) => {
          const nodes = group.nodes.filter((node) => node.role === role);
          if (nodes.length === 0) return null;
          return (
            <View key={role} style={styles.roleColumn}>
              <Text style={styles.roleTitle}>
                {role.toUpperCase()} · {nodes.length}
              </Text>
              {nodes.map((node) => {
                const edge = parentByChild.get(node.id);
                return (
                  <TopologyAgentCard
                    key={node.id}
                    serverId={serverId}
                    node={node}
                    edge={edge}
                    parent={edge ? nodeById.get(edge.source) : undefined}
                  />
                );
              })}
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function HostTopologyScreen({ serverId }: { serverId: string }) {
  const session = useSessionStore((state) => state.sessions[serverId]);
  const topology = useMemo(() => buildHostTopology(session?.agents), [session?.agents]);
  const projectGroups = useMemo(() => {
    const workspaces = session?.workspaces;
    const grouped = new Map<string, ProjectGroup>();
    for (const node of topology.nodes) {
      const workspace = node.workspaceId ? workspaces?.get(node.workspaceId) : undefined;
      const key = workspace?.projectId ?? "unassigned";
      const group = grouped.get(key) ?? {
        label: workspace?.projectDisplayName ?? "Unassigned agents",
        nodes: [],
      };
      group.nodes.push(node);
      grouped.set(key, group);
    }
    return [...grouped.entries()].sort((left, right) =>
      left[1].label.localeCompare(right[1].label),
    );
  }, [session?.workspaces, topology.nodes]);
  const parentByChild = useMemo(
    () => new Map(topology.edges.map((edge) => [edge.target, edge])),
    [topology.edges],
  );
  const nodeById = useMemo(
    () => new Map(topology.nodes.map((node) => [node.id, node])),
    [topology.nodes],
  );

  let content;
  if (!session?.hasHydratedAgents) {
    content = (
      <View style={styles.centered}>
        <LoadingSpinner size="large" color={styles.muted.color} />
      </View>
    );
  } else if (projectGroups.length === 0) {
    content = (
      <View style={styles.centered}>
        <Network size={28} color={styles.muted.color} />
        <Text style={styles.emptyTitle}>No active agents</Text>
        <Text style={styles.emptyText}>Create role-bound agents to populate project topology.</Text>
      </View>
    );
  } else {
    content = (
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.summary}>
          <Text style={styles.summaryTitle}>All projects</Text>
          <Text style={styles.summaryMeta}>
            {topology.nodes.length} active agents · {topology.edges.length} exact relationship
            {topology.edges.length === 1 ? "" : "s"}
          </Text>
          {topology.counts.unbound > 0 ? (
            <Text style={styles.warning}>
              {topology.counts.unbound} unbound agent{topology.counts.unbound === 1 ? "" : "s"};
              provider subagents are not Paseo Peers.
            </Text>
          ) : null}
        </View>
        {projectGroups.map(([projectId, group]) => (
          <ProjectTopologySection
            key={projectId}
            serverId={serverId}
            group={group}
            parentByChild={parentByChild}
            nodeById={nodeById}
          />
        ))}
      </ScrollView>
    );
  }

  return (
    <View style={styles.screen} testID="host-topology-screen">
      <MenuHeader title="Project topology" />
      {content}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  content: { padding: theme.spacing[6], gap: theme.spacing[6] },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: theme.spacing[2] },
  muted: { color: theme.colors.foregroundMuted },
  emptyTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.lg },
  emptyText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  summary: { gap: theme.spacing[1] },
  summaryTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.medium,
  },
  summaryMeta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  warning: { color: theme.colors.statusWarning, fontSize: theme.fontSize.sm },
  projectSection: { gap: theme.spacing[3] },
  projectTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.medium,
  },
  roleGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[3],
    alignItems: "flex-start",
  },
  roleColumn: { width: 280, gap: theme.spacing[2] },
  roleTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    letterSpacing: 0.7,
  },
  agentCard: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    padding: theme.spacing[3],
    gap: theme.spacing[1],
  },
  agentCardActive: { borderColor: theme.colors.accent, backgroundColor: theme.colors.surface2 },
  agentHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  agentTitle: { flex: 1, color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  agentMeta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  relation: { color: theme.colors.accent, fontSize: theme.fontSize.xs },
  statusDot: { width: 8, height: 8, borderRadius: theme.borderRadius.full },
  status_initializing: { backgroundColor: theme.colors.statusDotWarning },
  status_idle: { backgroundColor: theme.colors.statusDotSuccess },
  status_running: { backgroundColor: theme.colors.statusDotRunning },
  status_error: { backgroundColor: theme.colors.statusDotDanger },
  status_closed: { backgroundColor: theme.colors.foregroundExtraMuted },
}));
