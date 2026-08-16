export type AgentProfileApplyPolicyTarget =
  | { kind: "draft" }
  | { kind: "agent"; roleBound: boolean };

/** Role-bound routes are immutable; select a preset only while creating the replacement. */
export function agentProfileTargetAllowsApply(target: AgentProfileApplyPolicyTarget): boolean {
  return target.kind === "draft" || !target.roleBound;
}
