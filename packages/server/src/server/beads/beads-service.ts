import { createHash } from "node:crypto";

import { z } from "zod";
import {
  BeadsIssueSchema,
  BeadsIssueStatusSchema,
  BeadsIssueTypeSchema,
  type BeadsIssue,
} from "@getpaseo/protocol/beads/rpc-schemas";

export const PASEO_BEADS_CENTRAL_VERSION = "1.2.0";

export { BeadsIssueSchema, BeadsIssueStatusSchema, BeadsIssueTypeSchema };
export const BeadsWritableIssueStatusSchema = BeadsIssueStatusSchema.exclude(["closed"]);
export const BeadsDependencyTypeSchema = z.enum([
  "blocks",
  "tracks",
  "related",
  "parent-child",
  "discovered-from",
  "until",
  "caused-by",
  "validates",
  "relates-to",
  "supersedes",
]);

export type { BeadsIssue };

export interface BeadsProjectContext {
  /** Paseo project ID. The Central logical work-graph ID is resolved server-side. */
  projectId: string;
  actor: string;
}

export interface BeadsMutationGuard {
  kind: "owned-mutation" | "claim";
  issueId: string;
  actor: string;
  requireNotClosed: true;
  signal?: AbortSignal;
}

export interface BeadsCreateInput {
  title: string;
  description?: string;
  issueType: z.infer<typeof BeadsIssueTypeSchema>;
  priority: number;
  labels?: string[];
  acceptance?: string;
  discoveredFrom?: string;
  idempotencyKey: string;
}

export interface BeadsListInput {
  status?: z.infer<typeof BeadsIssueStatusSchema>[];
  issueType?: z.infer<typeof BeadsIssueTypeSchema>;
  priority?: number;
  assignee?: string;
  labels?: string[];
  limit?: number;
}

export interface BeadsUpdateInput {
  title?: string;
  description?: string;
  priority?: number;
  status?: z.infer<typeof BeadsWritableIssueStatusSchema>;
  appendNotes?: string;
  addLabels?: string[];
  removeLabels?: string[];
  idempotencyKey: string;
}

export interface BeadsRuntimeStatus {
  available: boolean;
  version: string;
  reason?: string;
}

export interface BeadsService {
  status(signal?: AbortSignal): Promise<BeadsRuntimeStatus>;
  ready(context: BeadsProjectContext, limit?: number, signal?: AbortSignal): Promise<BeadsIssue[]>;
  list(
    context: BeadsProjectContext,
    input: BeadsListInput,
    signal?: AbortSignal,
  ): Promise<BeadsIssue[]>;
  get(context: BeadsProjectContext, issueId: string, signal?: AbortSignal): Promise<BeadsIssue>;
  create(
    context: BeadsProjectContext,
    input: BeadsCreateInput,
    signal?: AbortSignal,
    guard?: BeadsMutationGuard,
  ): Promise<BeadsIssue>;
  claim(
    context: BeadsProjectContext,
    issueId: string,
    idempotencyKey: string,
    signal?: AbortSignal,
    guard?: BeadsMutationGuard,
  ): Promise<BeadsIssue>;
  update(
    context: BeadsProjectContext,
    issueId: string,
    input: BeadsUpdateInput,
    signal?: AbortSignal,
    guard?: BeadsMutationGuard,
  ): Promise<BeadsIssue>;
  close(
    context: BeadsProjectContext,
    issueId: string,
    reason: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<BeadsIssue>;
  addDependency(
    context: BeadsProjectContext,
    issueId: string,
    dependsOnId: string,
    dependencyType: z.infer<typeof BeadsDependencyTypeSchema>,
    idempotencyKey: string,
    signal?: AbortSignal,
    guard?: BeadsMutationGuard,
  ): Promise<BeadsIssue>;
  prime(context: BeadsProjectContext, signal?: AbortSignal): Promise<string>;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function beadsActorForAgent(agentId: string): string {
  const normalized = agentId
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  const readable = normalized || "agent";
  if (readable.length <= 64) return `paseo-agent-${readable}`;
  return `paseo-agent-${readable.slice(0, 48)}-${sha256(agentId).slice(0, 12)}`;
}

export function deriveWorkGraphId(seed: string): string {
  return `pg-${sha256(seed).slice(0, 32)}`;
}

export function deriveWorkGraphPrefix(workGraphId: string): string {
  return `ps${sha256(workGraphId).slice(0, 10)}`;
}
