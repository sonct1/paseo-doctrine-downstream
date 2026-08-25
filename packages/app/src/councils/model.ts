import type { AgentLifecycleStatus } from "@getpaseo/protocol/agent-lifecycle";
import type { RoleBindingReceipt } from "@getpaseo/protocol/role-binding";
import {
  COUNCIL_PHASES,
  COUNCIL_SEAT_ROLES,
  COUNCIL_TIERS,
  type CouncilCaseRecord,
  type CouncilPhase,
  type CouncilSeatIntegrity,
  type CouncilSeatReportReceipt,
  type CouncilSeatRole,
  type CouncilTier,
} from "@getpaseo/protocol/council/types";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { projectDisplayNameFromProjectId } from "@/utils/project-display-name";

export { COUNCIL_PHASES, COUNCIL_SEAT_ROLES as COUNCIL_ROLES, COUNCIL_TIERS };
export type { CouncilPhase, CouncilSeatIntegrity, CouncilTier };
export type CouncilRole = CouncilSeatRole;

export interface CouncilAgentSource {
  id: string;
  serverId: string;
  title: string | null;
  status: AgentLifecycleStatus;
  model?: string | null;
  provider: string;
  workspaceId?: string;
  parentAgentId?: string | null;
  roleBinding?: RoleBindingReceipt;
  labels: Readonly<Record<string, string>>;
  lastActivityAt: Date;
  requiresAttention?: boolean;
  attentionReason?: "finished" | "error" | "permission" | null;
  pendingPermissionCount?: number;
}

export interface CouncilSeat {
  agentId: string | null;
  agent: CouncilAgentSource | null;
  role: CouncilRole;
  round: string;
  phase: CouncilPhase;
  integrity: CouncilSeatIntegrity;
  disposition: string | null;
  reportReceipt: CouncilSeatReportReceipt | null;
  updatedAt: Date;
}

export interface CouncilCase {
  id: string;
  scopeId: string;
  title: string;
  question: string;
  tier: CouncilTier;
  phase: CouncilPhase;
  serverId: string;
  projectId?: string;
  workspaceId?: string;
  parentAgentId: string | null;
  lead: CouncilAgentSource | null;
  verdictProvenance: "pending" | "lead-linked" | "unverified";
  disposition: string | null;
  seats: CouncilSeat[];
  reportSeatCount: number;
  readyCount: number;
  unavailableCount: number;
  redundantCount: number;
  updatedAt: Date;
}

export function councilCaseScopeIdentity(council: CouncilCase): string {
  return council.scopeId;
}

export interface CouncilPlacement {
  text: string;
  legacy: boolean;
}

const COUNCIL_PLACEMENT_LEGACY: CouncilPlacement = { text: "Host-level (legacy)", legacy: true };

export function describeCouncilPlacement(
  council: Pick<CouncilCase, "workspaceId">,
  workspace: WorkspaceDescriptor | null,
): CouncilPlacement {
  if (!council.workspaceId) {
    return COUNCIL_PLACEMENT_LEGACY;
  }
  if (!workspace) {
    return {
      text: `Unavailable workspace (workspace: ${council.workspaceId})`,
      legacy: true,
    };
  }
  const projectName =
    workspace.projectCustomName ??
    workspace.projectDisplayName ??
    projectDisplayNameFromProjectId(workspace.projectId);
  const workspaceName = workspace.title ?? workspace.name;
  return { text: `${projectName} / ${workspaceName}`, legacy: false };
}

const ROLE_ORDER: Record<CouncilRole, number> = {
  scout: 0,
  architect: 1,
  reviewer: 2,
};

function compareSeats(left: CouncilSeat, right: CouncilSeat): number {
  const roleDifference = ROLE_ORDER[left.role] - ROLE_ORDER[right.role];
  return roleDifference !== 0
    ? roleDifference
    : left.round.localeCompare(right.round, undefined, { numeric: true });
}

function councilVerdictProvenance(
  phase: CouncilPhase,
  parentAgentId: string | null,
): CouncilCase["verdictProvenance"] {
  if (phase !== "verdict") return "pending";
  return parentAgentId ? "lead-linked" : "unverified";
}

function latestDisposition(seats: readonly CouncilSeat[]): string | null {
  return (
    [...seats]
      .filter((seat) => seat.disposition)
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0]
      ?.disposition ?? null
  );
}

export function isCouncilSeatReportReady(seat: CouncilSeat): boolean {
  return seat.integrity === "valid" && seat.reportReceipt !== null;
}

export function isCouncilSeatUnavailable(seat: CouncilSeat): boolean {
  if (seat.integrity === "redundant") return false;
  if (seat.integrity === "compromised" || seat.integrity === "missing") return true;
  if (isCouncilSeatReportReady(seat)) return false;
  if (seat.agentId && !seat.agent) return true;
  return seat.agent?.status === "error" || seat.agent?.attentionReason === "error";
}

function isCouncilSeatReportExpected(seat: CouncilSeat): boolean {
  return seat.integrity !== "redundant";
}

export function projectCouncilCases(
  records: readonly CouncilCaseRecord[],
  agents: readonly CouncilAgentSource[],
  serverId: string,
): CouncilCase[] {
  const agentById = new Map(
    agents.filter((agent) => agent.serverId === serverId).map((agent) => [agent.id, agent]),
  );

  return records
    .map((record): CouncilCase => {
      const leadCandidate = record.parentAgentId
        ? (agentById.get(record.parentAgentId) ?? null)
        : null;
      const lead =
        leadCandidate?.roleBinding?.roleId === "lead" &&
        leadCandidate.roleBinding.qualification === "implementation-supported"
          ? leadCandidate
          : null;
      const seats = record.seats
        .map(
          (seat): CouncilSeat => ({
            agentId: seat.agentId,
            agent: seat.agentId ? (agentById.get(seat.agentId) ?? null) : null,
            role: seat.role,
            round: seat.round,
            phase: seat.phase,
            integrity: seat.integrity,
            disposition: seat.disposition,
            reportReceipt: seat.reportReceipt,
            updatedAt: new Date(seat.updatedAt),
          }),
        )
        .sort(compareSeats);
      const reportSeats = seats.filter(isCouncilSeatReportExpected);

      return {
        id: record.id,
        scopeId: record.scopeId,
        title: record.title,
        question: record.question,
        tier: record.tier,
        phase: record.phase,
        serverId,
        projectId: record.projectId ?? undefined,
        workspaceId: record.workspaceId ?? undefined,
        parentAgentId: record.parentAgentId,
        lead,
        verdictProvenance: councilVerdictProvenance(record.phase, record.parentAgentId),
        disposition: latestDisposition(seats),
        seats,
        reportSeatCount: reportSeats.length,
        readyCount: reportSeats.filter(isCouncilSeatReportReady).length,
        unavailableCount: reportSeats.filter(isCouncilSeatUnavailable).length,
        redundantCount: seats.length - reportSeats.length,
        updatedAt: new Date(record.updatedAt),
      };
    })
    .sort((left, right) => {
      const activityDifference = right.updatedAt.getTime() - left.updatedAt.getTime();
      return activityDifference !== 0 ? activityDifference : left.title.localeCompare(right.title);
    });
}

export function councilRoleLabel(role: CouncilRole): string {
  if (role === "architect") return "Solution Architect";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function councilTierLabel(tier: CouncilTier): string {
  return tier.replaceAll("-", " ");
}

export function councilPhaseLabel(phase: CouncilPhase): string {
  if (phase === "sealed") return "Sealed round";
  if (phase === "audit") return "Draft audit";
  return phase.charAt(0).toUpperCase() + phase.slice(1);
}

export function councilCasePhaseLabel(
  council: Pick<CouncilCase, "phase" | "verdictProvenance">,
): string {
  if (council.phase !== "verdict") return councilPhaseLabel(council.phase);
  return council.verdictProvenance === "lead-linked"
    ? "Lead-linked verdict marker"
    : "Unverified verdict marker";
}
