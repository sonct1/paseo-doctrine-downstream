import type { BeadsIssue } from "@getpaseo/protocol/beads/rpc-schemas";
import type {
  RoleResourceGrantVerificationInput,
  RoleResourceGrantVerifier,
} from "../agent/agent-manager.js";
import type { WorkspaceRegistry } from "../workspace-registry.js";
import { beadsActorForAgent, type BeadsService } from "./beads-service.js";

export interface MutatingPeerGrantVerifierDependencies {
  service: Pick<BeadsService, "status" | "get">;
  workspaceRegistry: Pick<WorkspaceRegistry, "get">;
}

function assertOpenIssue(issueId: string, issue: BeadsIssue): void {
  if (issue.id !== issueId) {
    throw new Error(`Central returned issue ${issue.id} for requested grant ${issueId}`);
  }
  if (issue.status === "closed") {
    throw new Error(`Beads issue grant ${issueId} is closed`);
  }
}

export function createMutatingPeerGrantVerifier(
  dependencies: MutatingPeerGrantVerifierDependencies,
): RoleResourceGrantVerifier {
  return async (input: RoleResourceGrantVerificationInput): Promise<void> => {
    const assignment = input.roleBinding.assignmentContract;
    if (input.roleBinding.roleId !== "peer" || assignment?.envelope.effectClass !== "mutating") {
      return;
    }
    const issueIds = assignment.envelope.resourceGrants?.beadsIssueIds ?? [];
    if (issueIds.length === 0) {
      throw new Error("Mutating Peer assignment has no Beads issue grants to verify");
    }
    const workspace = await dependencies.workspaceRegistry.get(assignment.receipt.workspaceId);
    if (!workspace || workspace.archivedAt) {
      throw new Error(`Workspace ${assignment.receipt.workspaceId} is unavailable or archived`);
    }
    const status = await dependencies.service.status();
    if (!status.available) {
      throw new Error(status.reason ?? `Beads Central ${status.version} is unavailable`);
    }
    const context = {
      projectId: workspace.projectId,
      actor: beadsActorForAgent(input.agentId),
    };
    try {
      const issues = await Promise.all(
        issueIds.map((issueId) => dependencies.service.get(context, issueId)),
      );
      issues.forEach((issue, index) => assertOpenIssue(issueIds[index] as string, issue));
    } catch (error) {
      throw new Error(
        `beads_issue_grant_verification_failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  };
}
