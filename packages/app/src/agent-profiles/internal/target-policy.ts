import type { AgentProfile } from "@getpaseo/protocol/messages";

export type AgentProfileApplyPolicyTarget =
  | { kind: "draft"; roleBound: boolean }
  | { kind: "agent"; roleBound: boolean };

/** Role-bound routes use explicit launch contracts rather than Human-applied presets. */
export function agentProfileTargetAllowsApply(target: AgentProfileApplyPolicyTarget): boolean {
  return !target.roleBound;
}

/** Peer routing profiles are Lead orchestration inventory, not Human picker actions. */
export function isHumanSelectableAgentProfile(profile: Pick<AgentProfile, "peerSubrole">): boolean {
  return profile.peerSubrole === undefined;
}
