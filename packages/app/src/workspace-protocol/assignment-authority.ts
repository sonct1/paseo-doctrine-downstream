import type {
  AssignmentContractReceipt,
  AssignmentEffectClass,
} from "@getpaseo/protocol/assignment-contract";
import type { PaseoRoleId } from "@getpaseo/protocol/role-binding";

export interface AssignmentAuthorityOption {
  id: AssignmentEffectClass;
  label: string;
  description: string;
}

const ORDINARY_ASSIGNMENT_AUTHORITY_BY_ROLE = {
  lead: [
    {
      id: "mutating",
      label: "Work & coordinate",
      description: "Edit inside this workspace and delegate bounded work to Peers.",
    },
    {
      id: "read-only",
      label: "Inspect only",
      description: "Inspect without file writes; the provider is pinned to a no-write mode.",
    },
    {
      id: "delegation",
      label: "Coordinate only",
      description: "Delegate bounded Peer work without directly changing workspace files.",
    },
  ],
  peer: [
    {
      id: "mutating",
      label: "Implement bounded scope",
      description: "Edit only inside the assigned workspace and granted Beads issue scope.",
    },
    {
      id: "read-only",
      label: "Review only",
      description: "Inspect and report without changing workspace files.",
    },
  ],
  supervisor: [
    {
      id: "read-only",
      label: "Observe",
      description: "Inspect project activity and evidence without changing files or routing work.",
    },
    {
      id: "delegation",
      label: "Coordinate Leads",
      description: "Create and prompt bounded Lead children without changing workspace files.",
    },
  ],
} as const satisfies Record<PaseoRoleId, readonly AssignmentAuthorityOption[]>;

export function ordinaryAssignmentAuthorityOptionsForRole(
  roleId: PaseoRoleId,
): readonly AssignmentAuthorityOption[] {
  return ORDINARY_ASSIGNMENT_AUTHORITY_BY_ROLE[roleId];
}

export function defaultAssignmentEffectForRole(roleId: PaseoRoleId): AssignmentEffectClass {
  return ORDINARY_ASSIGNMENT_AUTHORITY_BY_ROLE[roleId][0].id;
}

export function assignmentAuthorityLabel(
  roleId: PaseoRoleId,
  effectClass: AssignmentEffectClass,
): string {
  return (
    ORDINARY_ASSIGNMENT_AUTHORITY_BY_ROLE[roleId].find((option) => option.id === effectClass)
      ?.label ?? effectClass
  );
}

export function formatAssignmentAuthorityReceipt(receipt: AssignmentContractReceipt): string[] {
  const assigner =
    receipt.assigner.kind === "human-session"
      ? "Human session"
      : `Agent ${receipt.assigner.agentId}`;
  const mutation =
    receipt.mutationBoundary.mode === "bounded-write"
      ? `bounded-write · ${receipt.mutationBoundary.scope}`
      : "no-write";
  const externalEffects =
    receipt.externalEffectBoundary.mode === "bounded"
      ? `bounded · ${receipt.externalEffectBoundary.scope}`
      : "denied";
  return [
    `Assignment: ${assignmentAuthorityLabel(receipt.roleId, receipt.effectClass)} · immutable`,
    `Mutation: ${mutation}`,
    `External effects: ${externalEffects}`,
    `Assigned by: ${assigner}`,
    ...(receipt.expiresAt ? [`Expires: ${receipt.expiresAt}`] : []),
  ];
}
