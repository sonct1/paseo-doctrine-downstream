import { useLocalSearchParams } from "expo-router";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { HostTopologyScreen } from "@/screens/host-topology-screen";

export default function HostTopologyRoute() {
  const params = useLocalSearchParams<{ serverId?: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  return (
    <HostRouteBootstrapBoundary>
      <HostTopologyScreen serverId={serverId} />
    </HostRouteBootstrapBoundary>
  );
}
