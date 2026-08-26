import {
  CouncilSeatRoleSchema,
  type CouncilSeatRole,
  type CouncilTier,
} from "@getpaseo/protocol/council/types";

import type { FoundationExecutionProfileId } from "./execution-profiles.js";

export const SLP_COUNCIL_POLICY_VERSION = "1";

export interface SlpCouncilSeatPlan {
  role: CouncilSeatRole;
  peerSubrole: CouncilSeatRole;
  executionProfile?: FoundationExecutionProfileId;
  reportStartSentinel: string;
  reportEndSentinel: string;
  labels: Record<string, string>;
}

export function councilReportSentinels(role: CouncilSeatRole): {
  startSentinel: string;
  endSentinel: string;
} {
  const prefix = role.toUpperCase();
  return {
    startSentinel: `${prefix}_COUNCIL_REPORT_V1`,
    endSentinel: `${prefix}_COUNCIL_REPORT_END`,
  };
}

export function validateCouncilSeatRoles(roles: readonly CouncilSeatRole[]): CouncilSeatRole[] {
  const validated = CouncilSeatRoleSchema.array().parse(roles);
  if (new Set(validated).size !== validated.length) {
    throw new Error("Council seat roles must be unique");
  }
  return validated;
}

export function buildCouncilKickoffBody(input: {
  caseId: string;
  title: string;
  question: string;
  tier: CouncilTier;
  roles: readonly CouncilSeatRole[];
}): string {
  return [
    `Council ${input.caseId}: ${input.title}`,
    `Question: ${input.question}`,
    `Tier: ${input.tier}. Sealed seats: ${input.roles.join(", ")}.`,
    "Each seat must report independently in this Room before the Lead records integrity.",
  ].join("\n");
}

export function assertCouncilKickoffBody(input: { body: string; caseId: string }): void {
  if (!input.body.includes(`Council ${input.caseId}:`)) {
    throw new Error(`Council '${input.caseId}' kickoff body does not match the pinned SLP policy`);
  }
}

export function buildCouncilSeatPlans(input: {
  caseId: string;
  title: string;
  tier: CouncilTier;
  roomId: string;
  kickoffMessageId: string;
  roles: readonly CouncilSeatRole[];
}): SlpCouncilSeatPlan[] {
  return input.roles.map((role) => {
    let executionProfile: FoundationExecutionProfileId | undefined;
    if (role === "architect") executionProfile = "solution-architect";
    if (role === "reviewer") executionProfile = "reviewer";
    const { startSentinel: reportStartSentinel, endSentinel: reportEndSentinel } =
      councilReportSentinels(role);
    return {
      role,
      peerSubrole: role,
      ...(executionProfile ? { executionProfile } : {}),
      reportStartSentinel,
      reportEndSentinel,
      labels: {
        "council.case_id": input.caseId,
        "council.title": input.title,
        "council.tier": input.tier,
        "council.phase": "sealed",
        "council.role": role,
        "council.round": "1",
        "council.integrity": "unspecified",
        "council.room_id": input.roomId,
        "council.kickoff_message_id": input.kickoffMessageId,
        "council.report_start_sentinel": reportStartSentinel,
        "council.report_end_sentinel": reportEndSentinel,
      },
    };
  });
}

export const SLP_COUNCIL_POLICY = {
  reportSentinels: councilReportSentinels,
  validateSeatRoles: validateCouncilSeatRoles,
  buildKickoffBody: buildCouncilKickoffBody,
  assertKickoffBody: assertCouncilKickoffBody,
  buildSeatPlans: buildCouncilSeatPlans,
};
