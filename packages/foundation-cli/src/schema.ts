import { z } from "zod";

export const FoundationManifestFileSchema = z.object({
  path: z.string().min(1),
  mode: z.string().regex(/^[0-7]{4}$/u),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});

export const FoundationManifestSchema = z.object({
  schemaVersion: z.literal(1),
  distributionVersion: z.string().min(1),
  foundationSource: z.object({
    commit: z.string().regex(/^[a-f0-9]{40}$/u),
    ref: z.string().min(1),
  }),
  files: z.array(FoundationManifestFileSchema).min(1),
});

export const InstallModeSchema = z.enum(["clean-empty", "coexist", "migration", "update"]);

export const PathStateSchema = z.enum([
  "absent",
  "owned-current",
  "owned-stale",
  "legacy-owned",
  "foreign",
]);

export const InstalledLinkSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
});

export const PreviousLinkSchema = z.object({
  target: z.string().min(1),
  previousTarget: z.string().nullable(),
});

export const InstallRecordSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.enum(["active", "uninstalled"]),
  mode: InstallModeSchema,
  distributionVersion: z.string().min(1),
  foundationCommit: z.string().regex(/^[a-f0-9]{40}$/u),
  installedAt: z.string().datetime(),
  releasePath: z.string().min(1),
  currentLink: z.string().min(1),
  controlHome: z.string().min(1).nullable(),
  installedLinks: z.array(InstalledLinkSchema),
  previousReleasePath: z.string().nullable(),
  previousCurrentTarget: z.string().nullable().optional(),
  previousLinks: z.array(PreviousLinkSchema).optional(),
  legacyRecordPath: z.string().nullable(),
  uninstalledAt: z.string().datetime().optional(),
  rolledBackAt: z.string().datetime().optional(),
});

export const InstallTransactionSchema = z.object({
  schemaVersion: z.literal(1),
  operation: z.literal("install"),
  ownerPid: z.number().int().positive(),
  planId: z.string().regex(/^[a-f0-9]{64}$/u),
  home: z.string().min(1),
  releasePath: z.string().min(1),
  releaseStagingPath: z.string().nullable(),
  controlHome: z.string().min(1),
  controlStagingPath: z.string().nullable(),
  controlTemplateFingerprint: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .nullable(),
  currentLink: z.string().min(1),
  previousCurrentTarget: z.string().nullable(),
  previousLinks: z.array(PreviousLinkSchema),
  installRecordPath: z.string().min(1),
  previousInstallRecordBase64: z.string().nullable(),
  createdAt: z.string().datetime(),
});

const Sha256DigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const GitCommitSchema = z.string().regex(/^[a-f0-9]{40}$/u);

export const RoleBoundaryCanaryRoleSchema = z
  .object({
    roleId: z.enum(["lead", "peer", "supervisor"]),
    agentId: z.string().min(1),
    workspaceId: z.string().min(1),
    provider: z.string().min(1),
    model: z.string().min(1),
    assignmentEffect: z.literal("read-only"),
    definitionDigest: Sha256DigestSchema,
    bindingDigest: Sha256DigestSchema,
    checks: z
      .object({
        immutableRoleBinding: z.literal(true),
        workspaceProtocolBound: z.literal(true),
        technicalNoWrite: z.literal(true),
        toolContractObserved: z.literal(true),
      })
      .strict(),
    evidence: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const RoleBoundaryCanaryReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    qualifiedAt: z.string().datetime(),
    foundation: z
      .object({
        distributionVersion: z.string().min(1),
        commit: GitCommitSchema,
        roleDefinitionsDigest: Sha256DigestSchema,
        roleBundlesDigest: Sha256DigestSchema,
      })
      .strict(),
    daemon: z
      .object({
        serverId: z.string().min(1),
        version: z.string().min(1),
        startedAt: z.string().datetime(),
        sourceCommit: GitCommitSchema,
        sourceFingerprint: Sha256DigestSchema,
      })
      .strict(),
    route: z
      .object({
        provider: z.string().min(1),
        model: z.string().min(1),
        providerConnectionQualifiedAt: z.string().datetime(),
      })
      .strict(),
    roles: z.array(RoleBoundaryCanaryRoleSchema).length(3),
  })
  .strict()
  .superRefine((receipt, context) => {
    const qualifiedAt = Date.parse(receipt.qualifiedAt);
    if (
      qualifiedAt < Date.parse(receipt.daemon.startedAt) ||
      qualifiedAt < Date.parse(receipt.route.providerConnectionQualifiedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["qualifiedAt"],
        message: "canary qualification must occur after daemon start and provider qualification",
      });
    }
    const roles = receipt.roles.map((role) => role.roleId);
    for (const required of ["lead", "peer", "supervisor"] as const) {
      if (roles.filter((role) => role === required).length !== 1) {
        context.addIssue({
          code: "custom",
          path: ["roles"],
          message: `canary receipt must contain exactly one ${required}`,
        });
      }
    }
    for (const role of receipt.roles) {
      if (role.provider !== receipt.route.provider || role.model !== receipt.route.model) {
        context.addIssue({
          code: "custom",
          path: ["roles"],
          message: `${role.roleId} route does not match the canary route`,
        });
      }
    }
  });

export const PlannedLinkSchema = InstalledLinkSchema.extend({
  state: PathStateSchema,
  previousTarget: z.string().nullable(),
});

export const InstallPlanSchema = z
  .object({
    schemaVersion: z.literal(2),
    planId: z.string().regex(/^[a-f0-9]{64}$/u),
    mode: InstallModeSchema,
    home: z.string().min(1),
    productRoot: z.string().min(1),
    distributionVersion: z.string().min(1),
    foundationCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    releasePath: z.string().min(1),
    currentLink: z.string().min(1),
    includeControlWorkspace: z.boolean(),
    controlHome: z.string().min(1).nullable(),
    controlHomePresent: z.boolean().nullable(),
    inspectionFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    links: z.array(PlannedLinkSchema),
    blockers: z.array(z.string()),
  })
  .superRefine((plan, context) => {
    const hasControlWorkspacePlan = plan.controlHome !== null && plan.controlHomePresent !== null;
    if (plan.includeControlWorkspace !== hasControlWorkspacePlan) {
      context.addIssue({
        code: "custom",
        message: "Control Workspace plan fields do not match the explicit inclusion choice",
      });
    }
  });

export type FoundationManifest = z.infer<typeof FoundationManifestSchema>;
export type InstallMode = z.infer<typeof InstallModeSchema>;
export type InstallPlan = z.infer<typeof InstallPlanSchema>;
export type InstallRecord = z.infer<typeof InstallRecordSchema>;
export type InstallTransaction = z.infer<typeof InstallTransactionSchema>;
export type RoleBoundaryCanaryReceipt = z.infer<typeof RoleBoundaryCanaryReceiptSchema>;
export type PathState = z.infer<typeof PathStateSchema>;
