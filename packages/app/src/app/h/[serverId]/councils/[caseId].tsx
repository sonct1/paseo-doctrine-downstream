import { useLocalSearchParams } from "expo-router";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { CouncilsScreen } from "@/councils/councils-screen";

export default function HostCouncilDetailRoute() {
  const params = useLocalSearchParams<{
    serverId?: string;
    caseId?: string;
    workspaceId?: string;
  }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  const caseId = typeof params.caseId === "string" ? params.caseId : "";
  const workspaceId = typeof params.workspaceId === "string" ? params.workspaceId : null;
  return (
    <HostRouteBootstrapBoundary>
      <CouncilsScreen
        serverId={serverId}
        selectedCaseId={caseId}
        selectedWorkspaceId={workspaceId}
      />
    </HostRouteBootstrapBoundary>
  );
}
