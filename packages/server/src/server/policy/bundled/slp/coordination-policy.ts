import type { LeadHandoffTransition } from "@getpaseo/protocol/lead-handoff";
import type { PaseoRoleId } from "@getpaseo/protocol/role-binding";

export const SLP_COORDINATION_POLICY_VERSION = "1";

export const SLP_COORDINATION_TOOL_DESCRIPTIONS = {
  prepareLeadHandoff:
    "Persist an immutable adjacent-Lead handoff packet. The predecessor remains write Owner; this does not authorize or release either Lead.",
  transitionLeadHandoff:
    "Record explicit Human authorization/release or the designated successor's acknowledgement/rejection. Final release requires an idle predecessor, closes its runtime while retaining the durable record, transfers current write ownership, and blocks later predecessor prompts without detaching, archiving, or changing role binding.",
  signalAgent:
    "Send a durable advisory handoff or detach recommendation to a role-bound Lead. Delivery waits for an idle boundary and never replaces an active run.",
  resolveAgentSignal:
    "Record the receiving role's autonomous disposition of a coordination signal. This does not report to or transfer authority to the sender.",
} as const;

export function assertPrepareLeadHandoffAuthority(input: {
  callerAgentId: string | undefined;
  callerRoleId: PaseoRoleId | undefined;
}): string {
  if (!input.callerAgentId) {
    throw new Error("prepare_lead_handoff requires an agent-scoped predecessor Lead");
  }
  if (input.callerRoleId !== "lead") {
    throw new Error("prepare_lead_handoff requires a role-bound predecessor Lead");
  }
  return input.callerAgentId;
}

export function assertLeadHandoffTransitionAuthority(input: {
  callerAgentId: string | undefined;
  transition: LeadHandoffTransition;
}): void {
  if (
    input.callerAgentId &&
    input.transition !== "successor_acknowledged" &&
    input.transition !== "rejected"
  ) {
    throw new Error("Only a Human-facing caller can authorize or release a Lead handoff");
  }
}

export function assertSignalAgentAuthority(input: {
  targetAgentId: string;
  targetRoleId: PaseoRoleId | undefined;
  callerRoleId: PaseoRoleId | undefined;
  callerAgentId: string | undefined;
  kind: "handoff_recommended" | "detach_recommended";
  relatedAgentId: string | undefined;
}): void {
  if (input.targetRoleId !== "lead") {
    throw new Error(
      `Coordination signals require a role-bound Lead target; ${input.targetAgentId} is not one`,
    );
  }
  if (input.kind === "detach_recommended" && !input.relatedAgentId) {
    throw new Error("detach_recommended requires relatedAgentId");
  }
  if (input.callerAgentId && input.callerRoleId !== "lead" && input.callerRoleId !== "supervisor") {
    throw new Error("Only a role-bound Lead or Supervisor can signal another Lead");
  }
}

export function assertResolveAgentSignalAuthority(input: {
  callerAgentId: string | undefined;
  requestedAgentId: string | undefined;
}): string {
  const targetAgentId = input.callerAgentId ?? input.requestedAgentId;
  if (!targetAgentId) {
    throw new Error("agentId is required outside an agent-scoped session");
  }
  if (
    input.callerAgentId &&
    input.requestedAgentId &&
    input.requestedAgentId !== input.callerAgentId
  ) {
    throw new Error("An agent may resolve only its own coordination signals");
  }
  return targetAgentId;
}

export const SLP_COORDINATION_POLICY = {
  descriptions: SLP_COORDINATION_TOOL_DESCRIPTIONS,
  assertPrepareLeadHandoffAuthority,
  assertLeadHandoffTransitionAuthority,
  assertSignalAgentAuthority,
  assertResolveAgentSignalAuthority,
};
