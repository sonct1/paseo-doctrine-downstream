import "@xyflow/react/dist/style.css";
import {
  Background,
  BackgroundVariant,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { Network } from "lucide-react-native";
import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { BeadsIssue } from "@getpaseo/protocol/beads/rpc-schemas";
import type { PanelRegistration } from "@/panels/panel-registry";
import type { TopologyNode } from "@/panels/topology-model";
import { layoutProjectTopologyXFirst } from "@/panels/topology-layout";
import { useTopologyPanelDescriptor, useTopologyPanelState } from "@/panels/use-topology-panel";
import type { Theme } from "@/styles/theme";

interface FlowNodeData extends Record<string, unknown> {
  topologyNode: TopologyNode;
  issues: {
    id: string;
    title: string;
    status: BeadsIssue["status"] | null;
  }[];
}
type FlowNode = Node<FlowNodeData, "agent">;

const ThemedNetwork = withUnistyles(Network);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const mutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

function AgentTopologyNode({ data, selected }: NodeProps<FlowNode>) {
  const node = data.topologyNode;
  return (
    <View style={[styles.node, selected && styles.nodeSelected]}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <View style={styles.nodeHeading}>
        <Text style={styles.roleLabel}>{node.role.toUpperCase()}</Text>
        <View style={[styles.statusDot, styles[`status_${node.status}`]]} />
      </View>
      <Text style={styles.nodeTitle} numberOfLines={1}>
        {node.title}
      </Text>
      <Text style={styles.nodeMeta} numberOfLines={1}>
        {node.status} · {node.provider}
      </Text>
      <Text style={styles.nodeMeta} numberOfLines={1}>
        {node.model ?? node.shortId}
      </Text>
      {data.issues.length > 0 ? (
        <View style={styles.nodeIssues}>
          <Text style={styles.nodeIssuesLabel}>Assigned issues</Text>
          {data.issues.slice(0, 2).map((issue) => (
            <View key={issue.id} style={styles.nodeIssueRow}>
              <Text style={styles.nodeIssueTitle} numberOfLines={1}>
                {issue.title}
              </Text>
              <Text style={styles.nodeIssueStatus} numberOfLines={1}>
                {issue.status?.replace("_", " ") ?? "unknown"}
              </Text>
            </View>
          ))}
          {data.issues.length > 2 ? (
            <Text style={styles.nodeIssueMore}>+{data.issues.length - 2} more</Text>
          ) : null}
        </View>
      ) : null}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </View>
  );
}

const NODE_TYPES = { agent: AgentTopologyNode };
const FIT_VIEW_OPTIONS = { padding: 0.24, minZoom: 0.4, maxZoom: 1.15 };

function toFlowNodes(
  nodes: TopologyNode[],
  edges: Edge[],
  issueById: ReadonlyMap<string, BeadsIssue>,
): FlowNode[] {
  const positions = layoutProjectTopologyXFirst(nodes, edges);
  return nodes.map((node) => {
    return {
      id: node.id,
      type: "agent",
      position: positions.get(node.id) ?? { x: 0, y: 0 },
      data: {
        topologyNode: node,
        issues: node.issueIds.map((issueId) => {
          const issue = issueById.get(issueId);
          return {
            id: issueId,
            title: issue?.title ?? issueId,
            status: issue?.status ?? null,
          };
        }),
      },
      draggable: false,
      connectable: false,
      deletable: false,
      selectable: true,
      ariaLabel: `Open ${node.title}, ${node.role}, ${node.status}, ${node.issueIds.length} assigned issues`,
    };
  });
}

function TopologyPanel() {
  const {
    topology,
    hydrated,
    openAgent,
    issueById,
    grantedIssueCount,
    issuesLoading,
    issuesError,
    projectName,
  } = useTopologyPanelState();
  const edges = useMemo<Edge[]>(
    () =>
      topology.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "smoothstep",
        label: edge.kind === "delegation" ? "delegates" : "supervises",
        markerEnd: { type: MarkerType.ArrowClosed },
        style: edge.provenance === "inferred" ? { strokeDasharray: "5 5" } : undefined,
        animated: false,
        selectable: false,
      })),
    [topology.edges],
  );
  const nodes = useMemo(
    () => toFlowNodes(topology.nodes, edges, issueById),
    [edges, issueById, topology.nodes],
  );
  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: FlowNode) => openAgent(node.id),
    [openAgent],
  );

  if (!hydrated) {
    return (
      <View style={styles.centered} testID="project-topology-loading">
        <ThemedLoadingSpinner size="large" uniProps={mutedColorMapping} />
      </View>
    );
  }
  if (nodes.length === 0) {
    return (
      <View style={styles.centered} testID="project-topology-empty">
        <ThemedNetwork size={24} uniProps={mutedColorMapping} />
        <Text style={styles.emptyTitle}>No active agents</Text>
        <Text style={styles.emptyText}>Create role-bound agents to populate this topology.</Text>
      </View>
    );
  }
  return (
    <View style={styles.container} testID="project-topology-panel">
      <ReactFlow<FlowNode, Edge>
        key="project-horizontal"
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodeClick={handleNodeClick}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        minZoom={0.25}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesReconnectable={false}
        elementsSelectable
        panOnDrag
        zoomOnScroll
        zoomOnPinch
        deleteKeyCode={null}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="currentColor" />
        <Panel position="top-left">
          <View style={styles.legend}>
            <Text style={styles.legendTitle}>Project topology · {projectName}</Text>
            <Text style={styles.legendMeta}>
              {nodes.length} agents · {edges.length} relationship
              {edges.length === 1 ? "" : "s"}
            </Text>
            <Text style={styles.legendMeta}>
              {grantedIssueCount} assigned issue
              {grantedIssueCount === 1 ? "" : "s"}
            </Text>
            <View style={styles.legendRules}>
              <Text style={styles.legendMeta}>Solid: exact supervision or delegation</Text>
            </View>
            {topology.warnings.length > 0 ? (
              <Text style={styles.warningText}>
                {topology.warnings.length} relationship
                {topology.warnings.length === 1 ? "" : "s"} need review
              </Text>
            ) : null}
            {issuesLoading && grantedIssueCount > 0 ? (
              <Text style={styles.legendMeta}>Loading issue details</Text>
            ) : null}
            {issuesError && grantedIssueCount > 0 ? (
              <Text style={styles.warningText}>
                Issue details unavailable; exact grants remain shown
              </Text>
            ) : null}
          </View>
        </Panel>
      </ReactFlow>
    </View>
  );
}

export const topologyPanelRegistration: PanelRegistration<"topology"> = {
  kind: "topology",
  component: TopologyPanel,
  useDescriptor: useTopologyPanelDescriptor,
};

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    color: theme.colors.foregroundMuted,
    backgroundColor: theme.colors.surface0,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surface0,
  },
  emptyTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  node: {
    width: 280,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    padding: theme.spacing[3],
    gap: theme.spacing[1],
  },
  nodeSelected: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.surface2,
  },
  nodeHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  roleLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    letterSpacing: 0.8,
  },
  nodeTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  nodeMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  nodeIssues: {
    marginTop: theme.spacing[2],
    paddingTop: theme.spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    gap: theme.spacing[1],
  },
  nodeIssuesLabel: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  nodeIssueRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  nodeIssueTitle: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
  },
  nodeIssueStatus: {
    maxWidth: 80,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    textTransform: "capitalize",
  },
  nodeIssueMore: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  statusDot: { width: 8, height: 8, borderRadius: theme.borderRadius.full },
  status_initializing: { backgroundColor: theme.colors.statusDotWarning },
  status_idle: { backgroundColor: theme.colors.statusDotSuccess },
  status_running: { backgroundColor: theme.colors.statusDotRunning },
  status_error: { backgroundColor: theme.colors.statusDotDanger },
  status_closed: { backgroundColor: theme.colors.foregroundExtraMuted },
  legend: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    padding: theme.spacing[3],
    gap: theme.spacing[1],
  },
  legendTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  legendMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  legendRules: { marginTop: theme.spacing[1], gap: 2 },
  warningText: {
    color: theme.colors.statusWarning,
    fontSize: theme.fontSize.xs,
    marginTop: theme.spacing[1],
  },
}));
