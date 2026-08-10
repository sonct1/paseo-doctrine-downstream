import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { PaseoRoleId } from "@getpaseo/protocol/role-binding";
import { buildProjectSettingsRoute } from "@/utils/host-routes";

export type WorkspaceProtocolCreateAdmissionFailureKind = "invalid" | "unreadable";

export function workspaceProtocolAdmissionMessageKey(
  _kind: WorkspaceProtocolCreateAdmissionFailureKind,
): "workspaceSetup.errors.workspaceProtocolRequired" {
  return "workspaceSetup.errors.workspaceProtocolRequired";
}

export class WorkspaceProtocolCreateAdmissionError extends Error {
  readonly kind: WorkspaceProtocolCreateAdmissionFailureKind;
  readonly projectSettingsRoute: ReturnType<typeof buildProjectSettingsRoute>;

  constructor(input: {
    kind: WorkspaceProtocolCreateAdmissionFailureKind;
    serverId: string;
    projectId: string;
    repoRoot: string;
  }) {
    super(`workspace_protocol_admission_required: ${input.kind}`);
    this.name = "WorkspaceProtocolCreateAdmissionError";
    this.kind = input.kind;
    this.projectSettingsRoute = buildProjectSettingsRoute(input.serverId, input.projectId, {
      protocolRoot: input.repoRoot,
    });
  }
}

export async function requireWorkspaceProtocolForRole(input: {
  client: Pick<DaemonClient, "inspectWorkspaceProtocol">;
  serverId: string;
  projectId: string;
  repoRoot: string;
  roleId: PaseoRoleId | null | undefined;
  supported: boolean;
}): Promise<void> {
  if (!input.roleId) return undefined;

  if (!input.supported) {
    return;
  }

  let result: Awaited<ReturnType<DaemonClient["inspectWorkspaceProtocol"]>>;
  try {
    result = await input.client.inspectWorkspaceProtocol(input.repoRoot);
  } catch {
    return;
  }

  if (!result.ok) {
    return;
  }
  if (result.snapshot.status === "valid" || result.snapshot.status === "missing") return;

  throw new WorkspaceProtocolCreateAdmissionError({
    kind: result.snapshot.status,
    serverId: input.serverId,
    projectId: input.projectId,
    repoRoot: input.repoRoot,
  });
}
