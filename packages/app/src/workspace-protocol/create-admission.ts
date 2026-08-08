import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { PaseoRoleId } from "@getpaseo/protocol/role-binding";
import type {
  AssignmentEffectClass,
  AssignmentEnvelope,
} from "@getpaseo/protocol/assignment-contract";
import { buildProjectSettingsRoute } from "@/utils/host-routes";

export type WorkspaceProtocolCreateAdmissionFailureKind =
  | "unsupported"
  | "inspection_failed"
  | "missing"
  | "invalid"
  | "unreadable";

export function workspaceProtocolAdmissionMessageKey(
  kind: WorkspaceProtocolCreateAdmissionFailureKind,
):
  | "workspaceSetup.errors.workspaceProtocolRequired"
  | "workspaceSetup.errors.workspaceProtocolUnsupported"
  | "workspaceSetup.errors.workspaceProtocolInspectionFailed" {
  if (kind === "unsupported") return "workspaceSetup.errors.workspaceProtocolUnsupported";
  if (kind === "inspection_failed") {
    return "workspaceSetup.errors.workspaceProtocolInspectionFailed";
  }
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
  effectClass: AssignmentEffectClass;
  supported: boolean;
  now?: Date;
}): Promise<AssignmentEnvelope["protocolException"] | undefined> {
  if (!input.roleId) return undefined;

  if (!input.supported) {
    throw new WorkspaceProtocolCreateAdmissionError({
      kind: "unsupported",
      serverId: input.serverId,
      projectId: input.projectId,
      repoRoot: input.repoRoot,
    });
  }

  let result: Awaited<ReturnType<DaemonClient["inspectWorkspaceProtocol"]>>;
  try {
    result = await input.client.inspectWorkspaceProtocol(input.repoRoot);
  } catch {
    throw new WorkspaceProtocolCreateAdmissionError({
      kind: "inspection_failed",
      serverId: input.serverId,
      projectId: input.projectId,
      repoRoot: input.repoRoot,
    });
  }

  if (!result.ok) {
    throw new WorkspaceProtocolCreateAdmissionError({
      kind: "inspection_failed",
      serverId: input.serverId,
      projectId: input.projectId,
      repoRoot: input.repoRoot,
    });
  }
  if (result.snapshot.status === "valid") return undefined;
  if (
    result.snapshot.status === "missing" &&
    new Set<AssignmentEffectClass>(["read-only", "bootstrap", "recovery"]).has(input.effectClass)
  ) {
    const expiresAt = new Date((input.now ?? new Date()).getTime() + 30 * 60 * 1_000).toISOString();
    return {
      reason: `${input.effectClass} work while the repository protocol is being bootstrapped`,
      scope: input.repoRoot,
      expiresAt,
    };
  }

  throw new WorkspaceProtocolCreateAdmissionError({
    kind: result.snapshot.status,
    serverId: input.serverId,
    projectId: input.projectId,
    repoRoot: input.repoRoot,
  });
}
