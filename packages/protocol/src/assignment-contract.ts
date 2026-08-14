import { z } from "zod";

export const PASEO_ASSIGNMENT_CONTRACT_VERSION = 1 as const;

export const AssignmentEffectClassSchema = z.enum([
  "read-only",
  "mutating",
  "delegation",
  "bootstrap",
  "recovery",
]);
export type AssignmentEffectClass = z.infer<typeof AssignmentEffectClassSchema>;

export const PASEO_ASSIGNMENT_EFFECTS_BY_ROLE = {
  lead: ["read-only", "mutating", "delegation", "bootstrap", "recovery"],
  peer: ["read-only", "mutating"],
  supervisor: ["read-only", "bootstrap", "recovery"],
} as const satisfies Record<"lead" | "peer" | "supervisor", readonly AssignmentEffectClass[]>;

export const PASEO_BEADS_EXTERNAL_EFFECT_SCOPE =
  "Beads Central issue/work graph for this assignment only; no other external effects";

export function isAssignmentEffectAllowedForRole(
  roleId: keyof typeof PASEO_ASSIGNMENT_EFFECTS_BY_ROLE,
  effectClass: AssignmentEffectClass,
): boolean {
  const allowed: readonly AssignmentEffectClass[] = PASEO_ASSIGNMENT_EFFECTS_BY_ROLE[roleId];
  return allowed.includes(effectClass);
}

/**
 * Default external-effect lease for Human-launched Foundation roles.
 *
 * Lead work that can change durable work state and mutating Peer work need a
 * narrow Beads Central lease. Read-only work and every Supervisor assignment
 * remain externally denied; server-side role guards still enforce the exact
 * mutation authority for each Beads operation.
 */
export function assignmentExternalEffectBoundaryFor(
  roleId: keyof typeof PASEO_ASSIGNMENT_EFFECTS_BY_ROLE,
  effectClass: AssignmentEffectClass,
): AssignmentExternalEffectBoundary {
  const canMutateBeads =
    (roleId === "lead" && effectClass !== "read-only") ||
    (roleId === "peer" && effectClass === "mutating");
  return canMutateBeads
    ? { mode: "bounded", scope: PASEO_BEADS_EXTERNAL_EFFECT_SCOPE }
    : { mode: "denied" };
}

export const PASEO_ASSIGNMENT_EFFECT_SUMMARIES = [
  {
    id: "read-only",
    label: "Read-only lease",
    description:
      "No workspace mutation. Launch fails unless the provider can enforce a no-write mode.",
  },
  {
    id: "mutating",
    label: "Workspace-write lease",
    description:
      "Authorizes writes only inside this workspace; technical containment is provider-specific.",
  },
  {
    id: "delegation",
    label: "Delegation lease",
    description:
      "Route bounded work without direct mutation; the launched agent remains technically no-write.",
  },
  {
    id: "bootstrap",
    label: "Bootstrap lease",
    description: "Prepare only the missing governance artifacts named by the assignment.",
  },
  {
    id: "recovery",
    label: "Recovery lease",
    description: "Perform only the exact Human-authorized recovery actions.",
  },
] as const satisfies ReadonlyArray<{
  id: AssignmentEffectClass;
  label: string;
  description: string;
}>;

export const AssignmentDispositionSchema = z.enum([
  "lead-direct",
  "peer-execution",
  "independent-review",
  "supervision",
]);
export type AssignmentDisposition = z.infer<typeof AssignmentDispositionSchema>;

export const AssignmentMutationBoundarySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("no-write") }),
  z.object({ mode: z.literal("bounded-write"), scope: z.string().trim().min(1) }),
]);

export const AssignmentExternalEffectBoundarySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("denied") }),
  z.object({ mode: z.literal("bounded"), scope: z.string().trim().min(1) }),
]);
export type AssignmentExternalEffectBoundary = z.infer<
  typeof AssignmentExternalEffectBoundarySchema
>;

const AssignmentTimestampSchema = z.string().datetime({ offset: true });

export const WorkspaceProtocolAdmissionExceptionSchema = z.object({
  reason: z.string().trim().min(1),
  scope: z.string().trim().min(1),
  expiresAt: AssignmentTimestampSchema,
});

const AssignmentBeadsIssueIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u);

/** Exact durable resources leased to this one-task assignment. */
export const AssignmentResourceGrantsSchema = z
  .object({
    beadsIssueIds: z.array(AssignmentBeadsIssueIdSchema).max(100).optional(),
  })
  .strict();
export type AssignmentResourceGrants = z.infer<typeof AssignmentResourceGrantsSchema>;

/** Caller-authored one-task envelope. Cross-field authority checks remain daemon-owned. */
export const AssignmentEnvelopeSchema = z.object({
  version: z.literal(PASEO_ASSIGNMENT_CONTRACT_VERSION),
  disposition: AssignmentDispositionSchema,
  objective: z.string().trim().min(1),
  effectClass: AssignmentEffectClassSchema,
  mutationBoundary: AssignmentMutationBoundarySchema,
  externalEffectBoundary: AssignmentExternalEffectBoundarySchema,
  evidence: z.string().trim().min(1),
  handbackAndStop: z.string().trim().min(1),
  resourceGrants: AssignmentResourceGrantsSchema.optional(),
  expiresAt: AssignmentTimestampSchema.optional(),
  protocolException: WorkspaceProtocolAdmissionExceptionSchema.optional(),
});
export type AssignmentEnvelope = z.infer<typeof AssignmentEnvelopeSchema>;

export const AssignmentAssignerReceiptSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("human-session") }),
  z.object({ kind: z.literal("agent"), agentId: z.string().min(1) }),
]);
export type AssignmentAssignerReceipt = z.infer<typeof AssignmentAssignerReceiptSchema>;

const Sha256DigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);

/** Secret-safe immutable receipt projected to clients. */
export const AssignmentContractReceiptSchema = z.object({
  version: z.literal(PASEO_ASSIGNMENT_CONTRACT_VERSION),
  assignmentDigest: Sha256DigestSchema,
  roleId: z.enum(["lead", "peer", "supervisor"]),
  disposition: AssignmentDispositionSchema,
  assigner: AssignmentAssignerReceiptSchema,
  workspaceId: z.string().min(1),
  cwd: z.string().min(1),
  effectClass: AssignmentEffectClassSchema,
  mutationBoundary: AssignmentMutationBoundarySchema,
  externalEffectBoundary: AssignmentExternalEffectBoundarySchema,
  resourceGrants: AssignmentResourceGrantsSchema.optional(),
  protocolExceptionExpiresAt: AssignmentTimestampSchema.optional(),
  createdAt: AssignmentTimestampSchema,
  expiresAt: AssignmentTimestampSchema.optional(),
});
export type AssignmentContractReceipt = z.infer<typeof AssignmentContractReceiptSchema>;
