import { useLocalSearchParams } from "expo-router";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { IssuesScreen } from "@/issues/issues-screen";

export default function HostProjectIssuesRoute() {
  const params = useLocalSearchParams<{ serverId?: string; projectId?: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  const projectId = typeof params.projectId === "string" ? params.projectId : "";
  return (
    <HostRouteBootstrapBoundary>
      <IssuesScreen serverId={serverId} projectId={projectId} selectedIssueId={null} />
    </HostRouteBootstrapBoundary>
  );
}
