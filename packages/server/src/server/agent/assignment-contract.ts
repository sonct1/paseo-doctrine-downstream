import { createHash } from "node:crypto";
import {
  assignmentExternalEffectBoundaryFor,
  AssignmentContractReceiptSchema,
  AssignmentEnvelopeSchema,
  isAssignmentEffectAllowedForRole,
  PASEO_ASSIGNMENT_CONTRACT_VERSION,
  type AssignmentAssignerReceipt,
  type AssignmentContractReceipt,
  type AssignmentEnvelope,
} from "@getpaseo/protocol/assignment-contract";
import type { PaseoRoleId } from "@getpaseo/protocol/role-binding";
import { z } from "zod";

export const ASSIGNMENT_CONTRACT_REQUIRED_ERROR = "assignment_contract_required";
export const ASSIGNMENT_CONTRACT_INVALID_ERROR = "assignment_contract_invalid";

export const PersistedAssignmentContractSchema = z.object({
  receipt: AssignmentContractReceiptSchema,
  envelope: AssignmentEnvelopeSchema,
});
export type PersistedAssignmentContract = z.infer<typeof PersistedAssignmentContractSchema>;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function trackerCheckpointForRole(
  roleId: PaseoRoleId,
  effectClass: AssignmentEnvelope["effectClass"],
): string {
  const canMutateTracker =
    assignmentExternalEffectBoundaryFor(roleId, effectClass).mode === "bounded";
  const receiptRule = `Resolve the exact logical tool from the current provider tool catalog; never guess or hard-code an MCP namespace. Only an authoritative Paseo tool receipt counts as the checkpoint; a missing or failed selector leaves issue state UNKNOWN${canMutateTracker ? " and blocks tracker mutation" : " while source inspection continues inside the no-write lease"}.`;
  if (roleId === "lead") {
    return `Mandatory Beads Central checkpoint: call beads_status at assignment start. ${receiptRule} Inspect or create the durable issue before material routing/work; update authoritative evidence at handoff; close only after your engineering verdict. If Central is unavailable, report BLOCKED and do not use native bd or another tracker.`;
  }
  if (roleId === "peer") {
    const issueScope =
      effectClass === "mutating"
        ? "inspect the daemon-verified granted issue"
        : "inspect a relevant issue when one is available; no issue grant is required for read-only source inspection";
    return `Mandatory Beads Central checkpoint: call beads_status and ${issueScope} at assignment start. ${receiptRule} Claim before owned mutation, update evidence/blockers before handoff, and never close. If Central is unavailable, do not use native bd or another tracker${canMutateTracker ? "; report BLOCKED" : "; continue only the read-only source inspection and report issue state UNKNOWN"}.`;
  }
  return `Mandatory Beads Central checkpoint: call beads_status and read the relevant issue graph at supervision start and material handoff when Central is available. ${receiptRule} Remain read-only. If Central is unavailable, continue only the no-write inspection, report issue state UNKNOWN, and do not use native bd or another tracker.`;
}

function requireFuture(iso: string | undefined, now: Date, field: string): void {
  if (iso !== undefined && Date.parse(iso) <= now.getTime()) {
    throw new Error(`${ASSIGNMENT_CONTRACT_INVALID_ERROR}: ${field} must be in the future`);
  }
}

function validateRoleDisposition(roleId: PaseoRoleId, envelope: AssignmentEnvelope): void {
  const allowed: Record<PaseoRoleId, readonly AssignmentEnvelope["disposition"][]> = {
    lead: ["lead-direct"],
    peer: ["peer-execution", "independent-review"],
    supervisor: ["supervision"],
  };
  if (!allowed[roleId].includes(envelope.disposition)) {
    throw new Error(
      `${ASSIGNMENT_CONTRACT_INVALID_ERROR}: disposition '${envelope.disposition}' does not match role '${roleId}'`,
    );
  }
  if (!isAssignmentEffectAllowedForRole(roleId, envelope.effectClass)) {
    throw new Error(
      `${ASSIGNMENT_CONTRACT_INVALID_ERROR}: effect '${envelope.effectClass}' is not allowed for role '${roleId}'`,
    );
  }
}

function validateEffectBoundaries(envelope: AssignmentEnvelope): void {
  const noWriteEffects = new Set<AssignmentEnvelope["effectClass"]>(["read-only", "delegation"]);
  if (noWriteEffects.has(envelope.effectClass) && envelope.mutationBoundary.mode !== "no-write") {
    throw new Error(
      `${ASSIGNMENT_CONTRACT_INVALID_ERROR}: ${envelope.effectClass} requires no-write`,
    );
  }
  if (envelope.effectClass === "mutating" && envelope.mutationBoundary.mode !== "bounded-write") {
    throw new Error(`${ASSIGNMENT_CONTRACT_INVALID_ERROR}: mutating requires bounded-write`);
  }
}

function validateExternalEffectBoundary(roleId: PaseoRoleId, envelope: AssignmentEnvelope): void {
  const requiredMode = assignmentExternalEffectBoundaryFor(roleId, envelope.effectClass).mode;
  if (requiredMode === "denied" && envelope.externalEffectBoundary.mode !== "denied") {
    throw new Error(
      `${ASSIGNMENT_CONTRACT_INVALID_ERROR}: ${roleId} ${envelope.effectClass} requires external effects ${requiredMode}`,
    );
  }
}

function validateResourceGrants(roleId: PaseoRoleId, envelope: AssignmentEnvelope): void {
  if (
    roleId === "peer" &&
    envelope.effectClass === "mutating" &&
    !envelope.resourceGrants?.beadsIssueIds?.length
  ) {
    throw new Error(
      `${ASSIGNMENT_CONTRACT_INVALID_ERROR}: mutating Peer requires an exact Beads issue grant`,
    );
  }
}

function validateProtocolException(
  envelope: AssignmentEnvelope,
  assigner: AssignmentAssignerReceipt,
  cwd: string,
  now: Date,
): void {
  const exception = envelope.protocolException;
  if (!exception) return;
  if (!new Set(["read-only", "bootstrap", "recovery"]).has(envelope.effectClass)) {
    throw new Error(
      `${ASSIGNMENT_CONTRACT_INVALID_ERROR}: protocol exception is not allowed for ${envelope.effectClass}`,
    );
  }
  if (assigner.kind !== "human-session") {
    throw new Error(
      `${ASSIGNMENT_CONTRACT_INVALID_ERROR}: protocol exception requires Human session issuer`,
    );
  }
  if (exception.scope !== cwd) {
    throw new Error(
      `${ASSIGNMENT_CONTRACT_INVALID_ERROR}: protocol exception scope must equal assignment cwd`,
    );
  }
  requireFuture(exception.expiresAt, now, "protocolException.expiresAt");
}

function canonicalAssignmentBytes(input: {
  roleId: PaseoRoleId;
  assigner: AssignmentAssignerReceipt;
  workspaceId: string;
  cwd: string;
  envelope: AssignmentEnvelope;
  createdAt: string;
}): string {
  return JSON.stringify({
    version: PASEO_ASSIGNMENT_CONTRACT_VERSION,
    roleId: input.roleId,
    assigner: input.assigner,
    workspaceId: input.workspaceId,
    cwd: input.cwd,
    envelope: input.envelope,
    createdAt: input.createdAt,
  });
}

export function materializeAssignmentContract(input: {
  roleId: PaseoRoleId;
  assigner: AssignmentAssignerReceipt;
  workspaceId: string;
  cwd: string;
  envelope: AssignmentEnvelope | undefined;
  createdAt?: Date;
}): PersistedAssignmentContract {
  if (!input.envelope) {
    throw new Error(ASSIGNMENT_CONTRACT_REQUIRED_ERROR);
  }
  const envelope = AssignmentEnvelopeSchema.parse(input.envelope);
  const now = input.createdAt ?? new Date();
  validateRoleDisposition(input.roleId, envelope);
  validateEffectBoundaries(envelope);
  validateExternalEffectBoundary(input.roleId, envelope);
  validateResourceGrants(input.roleId, envelope);
  validateProtocolException(envelope, input.assigner, input.cwd, now);
  requireFuture(envelope.expiresAt, now, "expiresAt");

  const createdAt = now.toISOString();
  const receipt: AssignmentContractReceipt = {
    version: PASEO_ASSIGNMENT_CONTRACT_VERSION,
    assignmentDigest: sha256(
      canonicalAssignmentBytes({
        roleId: input.roleId,
        assigner: input.assigner,
        workspaceId: input.workspaceId,
        cwd: input.cwd,
        envelope,
        createdAt,
      }),
    ),
    roleId: input.roleId,
    disposition: envelope.disposition,
    assigner: input.assigner,
    workspaceId: input.workspaceId,
    cwd: input.cwd,
    effectClass: envelope.effectClass,
    mutationBoundary: envelope.mutationBoundary,
    externalEffectBoundary: envelope.externalEffectBoundary,
    ...(envelope.resourceGrants ? { resourceGrants: envelope.resourceGrants } : {}),
    ...(envelope.protocolException
      ? { protocolExceptionExpiresAt: envelope.protocolException.expiresAt }
      : {}),
    createdAt,
    ...(envelope.expiresAt ? { expiresAt: envelope.expiresAt } : {}),
  };
  return PersistedAssignmentContractSchema.parse({ receipt, envelope });
}

export function buildAssignmentInstruction(contract: PersistedAssignmentContract): string {
  const { envelope, receipt } = contract;
  const writeScope =
    envelope.mutationBoundary.mode === "bounded-write"
      ? `bounded-write (${envelope.mutationBoundary.scope})`
      : "no-write";
  const externalScope =
    envelope.externalEffectBoundary.mode === "bounded"
      ? `bounded (${envelope.externalEffectBoundary.scope})`
      : "denied";
  const beadsIssueGrants = envelope.resourceGrants?.beadsIssueIds?.join(", ") || "none";
  const trackerCheckpoint = trackerCheckpointForRole(receipt.roleId, envelope.effectClass);
  return [
    `Assignment Contract: sha256=${receipt.assignmentDigest}; disposition=${envelope.disposition}; effect=${envelope.effectClass}.`,
    `Objective: ${envelope.objective}`,
    `Mutation boundary: ${writeScope}. External effects: ${externalScope}.`,
    `Beads issue grants: ${beadsIssueGrants}.`,
    trackerCheckpoint,
    `Evidence: ${envelope.evidence}`,
    `Handback/stop: ${envelope.handbackAndStop}`,
  ].join("\n");
}
