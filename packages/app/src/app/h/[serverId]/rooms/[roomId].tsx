import { useLocalSearchParams } from "expo-router";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { RoomsScreen } from "@/rooms/rooms-screen";

export default function HostRoomDetailRoute() {
  const params = useLocalSearchParams<{ serverId?: string; roomId?: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  const roomId = typeof params.roomId === "string" ? params.roomId : "";
  return (
    <HostRouteBootstrapBoundary>
      <RoomsScreen serverId={serverId} selectedRoomId={roomId} />
    </HostRouteBootstrapBoundary>
  );
}
