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

export const InstallRecordSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.enum(["active", "uninstalled"]),
  mode: InstallModeSchema,
  distributionVersion: z.string().min(1),
  foundationCommit: z.string().regex(/^[a-f0-9]{40}$/u),
  installedAt: z.string().datetime(),
  releasePath: z.string().min(1),
  currentLink: z.string().min(1),
  controlHome: z.string().min(1),
  installedLinks: z.array(InstalledLinkSchema),
  previousReleasePath: z.string().nullable(),
  legacyRecordPath: z.string().nullable(),
  uninstalledAt: z.string().datetime().optional(),
});

export const PlannedLinkSchema = InstalledLinkSchema.extend({
  state: PathStateSchema,
  previousTarget: z.string().nullable(),
});

export const InstallPlanSchema = z.object({
  schemaVersion: z.literal(1),
  planId: z.string().regex(/^[a-f0-9]{64}$/u),
  mode: InstallModeSchema,
  home: z.string().min(1),
  productRoot: z.string().min(1),
  distributionVersion: z.string().min(1),
  foundationCommit: z.string().regex(/^[a-f0-9]{40}$/u),
  releasePath: z.string().min(1),
  currentLink: z.string().min(1),
  controlHome: z.string().min(1),
  inspectionFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  links: z.array(PlannedLinkSchema),
  blockers: z.array(z.string()),
});

export type FoundationManifest = z.infer<typeof FoundationManifestSchema>;
export type InstallMode = z.infer<typeof InstallModeSchema>;
export type InstallPlan = z.infer<typeof InstallPlanSchema>;
export type InstallRecord = z.infer<typeof InstallRecordSchema>;
export type PathState = z.infer<typeof PathStateSchema>;
