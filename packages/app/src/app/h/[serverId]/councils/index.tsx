import { useLocalSearchParams } from "expo-router";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { CouncilsScreen } from "@/councils/councils-screen";

export default function HostCouncilsRoute() {
  const params = useLocalSearchParams<{ serverId?: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  return (
    <HostRouteBootstrapBoundary>
      <CouncilsScreen serverId={serverId} selectedCaseId={null} />
    </HostRouteBootstrapBoundary>
  );
}
