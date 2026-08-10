import { useLocalSearchParams } from "expo-router";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { IssuesScreen } from "@/issues/issues-screen";

export default function HostProjectIssueDetailRoute() {
  const params = useLocalSearchParams<{
    serverId?: string;
    projectId?: string;
    issueId?: string;
  }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  const projectId = typeof params.projectId === "string" ? params.projectId : "";
  const issueId = typeof params.issueId === "string" ? params.issueId : "";
  return (
    <HostRouteBootstrapBoundary>
      <IssuesScreen serverId={serverId} projectId={projectId} selectedIssueId={issueId} />
    </HostRouteBootstrapBoundary>
  );
}
