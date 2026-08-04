import { useLocalSearchParams } from "expo-router";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { RoomsScreen } from "@/rooms/rooms-screen";

export default function HostRoomsRoute() {
  const params = useLocalSearchParams<{ serverId?: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  return (
    <HostRouteBootstrapBoundary>
      <RoomsScreen serverId={serverId} selectedRoomId={null} />
    </HostRouteBootstrapBoundary>
  );
}
