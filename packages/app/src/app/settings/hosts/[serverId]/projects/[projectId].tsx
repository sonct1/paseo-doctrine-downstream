import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import SettingsScreen from "@/screens/settings-screen";
import { normalizeProjectSettingsRouteId } from "@/utils/host-routes";

export default function SettingsHostProjectDetailRoute() {
  const params = useLocalSearchParams<{
    serverId?: string | string[];
    projectId?: string | string[];
    protocolRoot?: string | string[];
  }>();
  const serverId = normalizeProjectSettingsRouteId(params.serverId);
  const projectId = normalizeProjectSettingsRouteId(params.projectId);
  const protocolRoot = normalizeProjectSettingsRouteId(params.protocolRoot);
  const view = useMemo(
    () => ({
      kind: "project" as const,
      serverId,
      projectId,
      ...(protocolRoot ? { protocolRoot } : {}),
    }),
    [projectId, protocolRoot, serverId],
  );

  return (
    <HostRouteBootstrapBoundary>
      <SettingsScreen view={view} />
    </HostRouteBootstrapBoundary>
  );
}
