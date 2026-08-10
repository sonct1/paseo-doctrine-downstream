import { z } from "zod";

export const BeadsIssueTypeSchema = z.enum(["bug", "feature", "task", "epic", "chore", "decision"]);

export const BeadsIssueStatusSchema = z.enum([
  "open",
  "in_progress",
  "blocked",
  "deferred",
  "closed",
]);

export const BeadsIssueSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    status: BeadsIssueStatusSchema,
    priority: z.number().int().min(0).max(4),
    issue_type: BeadsIssueTypeSchema,
    assignee: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    acceptance_criteria: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
    closed_at: z.string().nullable().optional(),
    close_reason: z.string().nullable().optional(),
  })
  .passthrough();

export const BeadsRuntimeStatusSchema = z.object({
  available: z.boolean(),
  version: z.string(),
  reason: z.string().optional(),
});

const ProjectRequestFields = {
  requestId: z.string(),
  projectId: z.string().min(1),
} as const;

export const BeadsIssuesListRequestSchema = z.object({
  type: z.literal("beads.issues.list.request"),
  ...ProjectRequestFields,
  status: z.array(BeadsIssueStatusSchema).max(5).optional(),
  limit: z.number().int().positive().max(100).optional(),
});

export const BeadsIssueCreateRequestSchema = z.object({
  type: z.literal("beads.issue.create.request"),
  ...ProjectRequestFields,
  title: z.string().trim().min(1).max(300),
  description: z.string().max(100_000).optional(),
  issueType: BeadsIssueTypeSchema,
  priority: z.number().int().min(0).max(4),
  acceptance: z.string().max(100_000).optional(),
  idempotencyKey: z.string().trim().min(1).max(128),
});

export const BeadsIssueGetRequestSchema = z.object({
  type: z.literal("beads.issue.get.request"),
  ...ProjectRequestFields,
  issueId: z.string().trim().min(1).max(128),
});

export const BeadsIssueCloseRequestSchema = z.object({
  type: z.literal("beads.issue.close.request"),
  ...ProjectRequestFields,
  issueId: z.string().trim().min(1).max(128),
  reason: z.string().trim().min(1).max(10_000),
  idempotencyKey: z.string().trim().min(1).max(128),
});

export const BeadsIssuesListResponseSchema = z.object({
  type: z.literal("beads.issues.list.response"),
  payload: z.object({
    requestId: z.string(),
    projectId: z.string(),
    runtime: BeadsRuntimeStatusSchema,
    issues: z.array(BeadsIssueSchema),
    error: z.string().nullable(),
  }),
});

export const BeadsIssueCreateResponseSchema = z.object({
  type: z.literal("beads.issue.create.response"),
  payload: z.object({
    requestId: z.string(),
    projectId: z.string(),
    issue: BeadsIssueSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const BeadsIssueGetResponseSchema = z.object({
  type: z.literal("beads.issue.get.response"),
  payload: z.object({
    requestId: z.string(),
    projectId: z.string(),
    issue: BeadsIssueSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const BeadsIssueCloseResponseSchema = z.object({
  type: z.literal("beads.issue.close.response"),
  payload: z.object({
    requestId: z.string(),
    projectId: z.string(),
    issue: BeadsIssueSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export type BeadsIssue = z.infer<typeof BeadsIssueSchema>;
export type BeadsIssueType = z.infer<typeof BeadsIssueTypeSchema>;
export type BeadsIssueStatus = z.infer<typeof BeadsIssueStatusSchema>;
export type BeadsRuntimeStatus = z.infer<typeof BeadsRuntimeStatusSchema>;
export type BeadsIssuesListRequest = z.infer<typeof BeadsIssuesListRequestSchema>;
export type BeadsIssueCreateRequest = z.infer<typeof BeadsIssueCreateRequestSchema>;
export type BeadsIssueGetRequest = z.infer<typeof BeadsIssueGetRequestSchema>;
export type BeadsIssueCloseRequest = z.infer<typeof BeadsIssueCloseRequestSchema>;
export type BeadsIssuesListPayload = z.infer<typeof BeadsIssuesListResponseSchema>["payload"];
export type BeadsIssueCreatePayload = z.infer<typeof BeadsIssueCreateResponseSchema>["payload"];
export type BeadsIssueGetPayload = z.infer<typeof BeadsIssueGetResponseSchema>["payload"];
export type BeadsIssueClosePayload = z.infer<typeof BeadsIssueCloseResponseSchema>["payload"];
