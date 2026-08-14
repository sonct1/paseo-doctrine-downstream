import {
  assignmentExternalEffectBoundaryFor,
  PASEO_ASSIGNMENT_CONTRACT_VERSION,
  type AssignmentEffectClass,
  type AssignmentEnvelope,
} from "@getpaseo/protocol/assignment-contract";
import type { PaseoRoleId } from "@getpaseo/protocol/role-binding";

function dispositionForRole(roleId: PaseoRoleId): AssignmentEnvelope["disposition"] {
  if (roleId === "lead") return "lead-direct";
  if (roleId === "peer") return "peer-execution";
  return "supervision";
}

function mutationBoundaryForEffect(
  effectClass: AssignmentEffectClass,
  cwd: string,
): AssignmentEnvelope["mutationBoundary"] {
  if (effectClass === "mutating") return { mode: "bounded-write", scope: cwd };
  if (effectClass === "bootstrap") {
    const separator = cwd.includes("\\") && !cwd.includes("/") ? "\\" : "/";
    return {
      mode: "bounded-write",
      scope: `${cwd.replace(/[\\/]+$/u, "")}${separator}WORKSPACE_PROTOCOL.md`,
    };
  }
  return { mode: "no-write" };
}

export function buildAssignmentEnvelope(input: {
  roleId: PaseoRoleId;
  effectClass: AssignmentEffectClass;
  objective: string;
  cwd: string;
  beadsIssueIds?: readonly string[];
}): AssignmentEnvelope {
  const objective = input.objective.trim();
  if (!objective) {
    throw new Error("assignment_contract_required: objective");
  }
  const beadsIssueIds = Array.from(
    new Set((input.beadsIssueIds ?? []).map((issueId) => issueId.trim()).filter(Boolean)),
  );
  if (input.roleId === "peer" && input.effectClass === "mutating" && beadsIssueIds.length === 0) {
    throw new Error("assignment_contract_required: mutating Peer Beads issue grant");
  }
  return {
    version: PASEO_ASSIGNMENT_CONTRACT_VERSION,
    disposition: dispositionForRole(input.roleId),
    objective,
    effectClass: input.effectClass,
    mutationBoundary: mutationBoundaryForEffect(input.effectClass, input.cwd),
    externalEffectBoundary: assignmentExternalEffectBoundaryFor(input.roleId, input.effectClass),
    ...(beadsIssueIds.length > 0 ? { resourceGrants: { beadsIssueIds } } : {}),
    evidence: "Return exact changed or inspected scope and proportional verification.",
    handbackAndStop:
      "Stop at completion or a material blocker; hand back evidence, unknowns, residual risk, and lease state.",
  };
}
