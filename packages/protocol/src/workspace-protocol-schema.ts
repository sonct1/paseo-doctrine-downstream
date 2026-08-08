import { z } from "zod";

export const WorkspaceProtocolRevisionSchema = z.object({
  mtimeMs: z.number(),
  size: z.number(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});

export const WorkspaceProtocolIssueSchema = z.enum([
  "empty",
  "missing_title",
  "missing_version_marker",
  "unsupported_version",
  "unresolved_placeholder",
  "conflict_marker",
  "missing_identity",
  "missing_risk",
  "missing_topology",
  "missing_ownership",
  "missing_routing",
  "missing_project_policy",
  "missing_review_evidence",
  "missing_escalation",
  "missing_exceptions",
  "too_large",
]);

const WorkspaceProtocolReadableSnapshotFields = {
  repoRoot: z.string(),
  path: z.string(),
  content: z.string(),
  revision: WorkspaceProtocolRevisionSchema,
  issues: z.array(WorkspaceProtocolIssueSchema),
};

export const WorkspaceProtocolSnapshotSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("missing"),
    repoRoot: z.string(),
    path: z.string(),
    suggestedContent: z.string(),
    revision: z.null(),
    issues: z.array(WorkspaceProtocolIssueSchema),
  }),
  z.object({
    status: z.literal("valid"),
    ...WorkspaceProtocolReadableSnapshotFields,
  }),
  z.object({
    status: z.literal("invalid"),
    ...WorkspaceProtocolReadableSnapshotFields,
  }),
  z.object({
    status: z.literal("unreadable"),
    repoRoot: z.string(),
    path: z.string(),
    revision: z.null(),
    issues: z.array(WorkspaceProtocolIssueSchema),
  }),
]);

export const WorkspaceProtocolRpcErrorSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("project_not_found") }),
  z.object({ code: z.literal("invalid_content"), issues: z.array(WorkspaceProtocolIssueSchema) }),
  z.object({
    code: z.literal("stale_workspace_protocol"),
    current: WorkspaceProtocolSnapshotSchema,
  }),
  z.object({ code: z.literal("write_failed") }),
]);

export type WorkspaceProtocolRevision = z.infer<typeof WorkspaceProtocolRevisionSchema>;
export type WorkspaceProtocolIssue = z.infer<typeof WorkspaceProtocolIssueSchema>;
export type WorkspaceProtocolSnapshot = z.infer<typeof WorkspaceProtocolSnapshotSchema>;
export type WorkspaceProtocolRpcError = z.infer<typeof WorkspaceProtocolRpcErrorSchema>;
