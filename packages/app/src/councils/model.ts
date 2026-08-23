import type { AgentLifecycleStatus } from "@getpaseo/protocol/agent-lifecycle";
import type { RoleBindingReceipt } from "@getpaseo/protocol/role-binding";

export const COUNCIL_TIERS = ["lens", "debate", "debate-with-proof", "high-risk"] as const;
export const COUNCIL_PHASES = ["sealed", "review", "audit", "verdict"] as const;
export const COUNCIL_ROLES = [
  "scout",
  "architect",
  "reviewer",
  "independent",
  "challenger",
  "specialist",
  "verifier",
  "auditor",
] as const;

export type CouncilTier = (typeof COUNCIL_TIERS)[number];
export type CouncilPhase = (typeof COUNCIL_PHASES)[number];
export type CouncilRole = (typeof COUNCIL_ROLES)[number];
export type CouncilSeatIntegrity =
  | "unspecified"
  | "valid"
  | "compromised"
  | "missing"
  | "redundant";

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
  agent: CouncilAgentSource;
  role: CouncilRole;
  round: string;
  phase: CouncilPhase;
  integrity: CouncilSeatIntegrity;
}

export interface CouncilCase {
  id: string;
  scopeId: string;
  title: string;
  tier: CouncilTier;
  phase: CouncilPhase;
  serverId: string;
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

const PHASE_ORDER: Record<CouncilPhase, number> = {
  sealed: 0,
  review: 1,
  audit: 2,
  verdict: 3,
};

const ROLE_ORDER: Record<CouncilRole, number> = {
  scout: 0,
  architect: 1,
  reviewer: 2,
  independent: 3,
  challenger: 4,
  specialist: 5,
  verifier: 6,
  auditor: 7,
};

function isCouncilTier(value: string): value is CouncilTier {
  return (COUNCIL_TIERS as readonly string[]).includes(value);
}

function isCouncilPhase(value: string): value is CouncilPhase {
  return (COUNCIL_PHASES as readonly string[]).includes(value);
}

function isCouncilRole(value: string): value is CouncilRole {
  return (COUNCIL_ROLES as readonly string[]).includes(value);
}

function readLabel(labels: Readonly<Record<string, string>>, key: string): string {
  return labels[key]?.trim() ?? "";
}

function councilSeatIntegrity(agent: CouncilAgentSource): CouncilSeatIntegrity {
  const integrity = readLabel(agent.labels, "council.integrity").toLowerCase();
  if (integrity.startsWith("valid")) return "valid";
  if (integrity.startsWith("compromised")) return "compromised";
  if (integrity.startsWith("missing")) return "missing";
  if (integrity.startsWith("redundant")) return "redundant";
  return "unspecified";
}

function councilDisposition(agent: CouncilAgentSource): string | null {
  return readLabel(agent.labels, "council.disposition") || null;
}

function hasCouncilReportReceipt(agent: CouncilAgentSource): boolean {
  const reportDigest = readLabel(agent.labels, "council.report_digest");
  const reportCreatedAt = readLabel(agent.labels, "council.report_created_at");
  return (
    readLabel(agent.labels, "council.room_id").length > 0 &&
    readLabel(agent.labels, "council.kickoff_message_id").length > 0 &&
    readLabel(agent.labels, "council.report_message_id").length > 0 &&
    readLabel(agent.labels, "council.report_start_sentinel").length > 0 &&
    readLabel(agent.labels, "council.report_end_sentinel").length > 0 &&
    /^[a-f0-9]{64}$/u.test(reportDigest) &&
    Number.isFinite(Date.parse(reportCreatedAt))
  );
}

function parseCouncilSeat(agent: CouncilAgentSource): CouncilSeat | null {
  const caseId = readLabel(agent.labels, "council.case_id");
  const tier = readLabel(agent.labels, "council.tier");
  const phase = readLabel(agent.labels, "council.phase");
  const role = readLabel(agent.labels, "council.role");
  if (!caseId || !isCouncilTier(tier) || !isCouncilPhase(phase) || !isCouncilRole(role)) {
    return null;
  }
  return {
    agent,
    role,
    phase,
    round: readLabel(agent.labels, "council.round") || "1",
    integrity: councilSeatIntegrity(agent),
  };
}

function compareSeats(left: CouncilSeat, right: CouncilSeat): number {
  const roleDifference = ROLE_ORDER[left.role] - ROLE_ORDER[right.role];
  if (roleDifference !== 0) {
    return roleDifference;
  }
  return left.round.localeCompare(right.round, undefined, { numeric: true });
}

function latestSeat(seats: readonly CouncilSeat[]): CouncilSeat {
  return seats.reduce((latest, seat) =>
    seat.agent.lastActivityAt.getTime() > latest.agent.lastActivityAt.getTime() ? seat : latest,
  );
}

export function isCouncilSeatReportReady(seat: CouncilSeat): boolean {
  return (
    seat.integrity === "valid" &&
    hasCouncilReportReceipt(seat.agent) &&
    (seat.agent.status === "idle" || seat.agent.status === "closed") &&
    seat.agent.attentionReason !== "error"
  );
}

export function isCouncilSeatUnavailable(seat: CouncilSeat): boolean {
  return (
    seat.integrity !== "redundant" &&
    (seat.integrity === "compromised" ||
      seat.integrity === "missing" ||
      seat.agent.status === "error" ||
      seat.agent.attentionReason === "error")
  );
}

function isCouncilSeatReportExpected(seat: CouncilSeat): boolean {
  return seat.integrity !== "redundant";
}

function councilVerdictProvenance(
  phase: CouncilPhase,
  lead: CouncilAgentSource | null,
): CouncilCase["verdictProvenance"] {
  if (phase !== "verdict") {
    return "pending";
  }
  return lead ? "lead-linked" : "unverified";
}

function councilAgentScopeIdentity(agent: CouncilAgentSource): string {
  if (agent.workspaceId) return `workspace:${agent.workspaceId}`;
  if (agent.parentAgentId) return `parent:${agent.parentAgentId}`;
  return `agent:${agent.id}`;
}

function councilCaseKey(agent: CouncilAgentSource, caseId: string): string {
  return JSON.stringify([agent.serverId, councilAgentScopeIdentity(agent), caseId]);
}

export function groupCouncilCases(
  agents: readonly CouncilAgentSource[],
  serverId?: string,
): CouncilCase[] {
  const agentByKey = new Map(agents.map((agent) => [`${agent.serverId}:${agent.id}`, agent]));
  const seatsByCase = new Map<string, CouncilSeat[]>();

  for (const agent of agents) {
    if (serverId && agent.serverId !== serverId) {
      continue;
    }
    const seat = parseCouncilSeat(agent);
    if (!seat) {
      continue;
    }
    const caseId = readLabel(agent.labels, "council.case_id");
    const key = councilCaseKey(agent, caseId);
    const seats = seatsByCase.get(key);
    if (seats) {
      seats.push(seat);
    } else {
      seatsByCase.set(key, [seat]);
    }
  }

  const cases: CouncilCase[] = [];
  for (const seats of seatsByCase.values()) {
    seats.sort(compareSeats);
    const newest = latestSeat(seats);
    const caseId = readLabel(newest.agent.labels, "council.case_id");
    const title = readLabel(newest.agent.labels, "council.title") || `Council ${caseId}`;
    const tier = readLabel(newest.agent.labels, "council.tier") as CouncilTier;
    const phase = seats.reduce(
      (latest, seat) => (PHASE_ORDER[seat.phase] > PHASE_ORDER[latest] ? seat.phase : latest),
      "sealed" as CouncilPhase,
    );
    const ownerSeat = [...seats]
      .sort(
        (left, right) => right.agent.lastActivityAt.getTime() - left.agent.lastActivityAt.getTime(),
      )
      .find((seat) => seat.agent.parentAgentId);
    const parentAgentIds = new Set(seats.map((seat) => seat.agent.parentAgentId ?? null));
    const soleParentAgentId = parentAgentIds.size === 1 ? [...parentAgentIds][0] : null;
    const parentAgentId = soleParentAgentId || null;
    const caseServerId = newest.agent.serverId;
    const linkedOwner = parentAgentId
      ? (agentByKey.get(`${caseServerId}:${parentAgentId}`) ?? null)
      : null;
    const lead =
      linkedOwner?.roleBinding?.roleId === "lead" &&
      linkedOwner.roleBinding.qualification === "implementation-supported"
        ? linkedOwner
        : null;
    const verdictProvenance = councilVerdictProvenance(phase, lead);
    const reportSeats = seats.filter(isCouncilSeatReportExpected);

    cases.push({
      id: caseId,
      scopeId: councilAgentScopeIdentity(newest.agent),
      title,
      tier,
      phase,
      serverId: caseServerId,
      workspaceId:
        ownerSeat?.agent.workspaceId ?? linkedOwner?.workspaceId ?? newest.agent.workspaceId,
      parentAgentId,
      lead,
      verdictProvenance,
      disposition: councilDisposition(newest.agent),
      seats,
      reportSeatCount: reportSeats.length,
      readyCount: reportSeats.filter(isCouncilSeatReportReady).length,
      unavailableCount: reportSeats.filter(isCouncilSeatUnavailable).length,
      redundantCount: seats.length - reportSeats.length,
      updatedAt: newest.agent.lastActivityAt,
    });
  }

  return cases.sort((left, right) => {
    const activityDifference = right.updatedAt.getTime() - left.updatedAt.getTime();
    return activityDifference !== 0 ? activityDifference : left.title.localeCompare(right.title);
  });
}

export function councilRoleLabel(role: CouncilRole): string {
  if (role === "architect") return "Solution Architect";
  if (role === "challenger") return "Premise Challenger";
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
  if (council.phase !== "verdict") {
    return councilPhaseLabel(council.phase);
  }
  return council.verdictProvenance === "lead-linked"
    ? "Lead-linked verdict marker"
    : "Unverified verdict marker";
}
