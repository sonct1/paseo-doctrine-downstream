import { z } from "zod";

import type { PaseoRoleId } from "@getpaseo/protocol/role-binding";

import type { AgentStorage } from "../agent/agent-storage.js";
import type {
  PaseoToolConfig,
  PaseoToolExecutionContext,
  PaseoToolResult,
} from "../agent/tools/types.js";
import type { PersistedAssignmentContract } from "../agent/assignment-contract.js";
import { ensureValidJson } from "../json-utils.js";
import type { ProjectRegistry, WorkspaceRegistry } from "../workspace-registry.js";
import {
  BeadsDependencyTypeSchema,
  BeadsIssueStatusSchema,
  BeadsIssueTypeSchema,
  BeadsWritableIssueStatusSchema,
  beadsActorForAgent,
  type BeadsMutationGuard,
  type BeadsProjectContext,
  type BeadsService,
} from "./beads-service.js";

const IssueIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u);
const IdempotencyKeySchema = z.string().trim().min(8).max(128);
const TitleSchema = z.string().trim().min(1).max(300);
const LongTextSchema = z.string().max(100_000);
const LabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => !value.includes(","), {
    message: "Labels cannot contain commas",
  });
const PrioritySchema = z.number().int().min(0).max(4);

interface BeadsCaller {
  roleId: PaseoRoleId;
  assignment: PersistedAssignmentContract;
  project: BeadsProjectContext;
}

export interface RegisterBeadsToolsOptions {
  registerTool: (
    name: string,
    config: PaseoToolConfig,
    handler: (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Inputs are parsed by the catalog schema boundary.
      input: any,
      context: PaseoToolExecutionContext,
    ) => Promise<PaseoToolResult>,
  ) => void;
  service: BeadsService;
  agentStorage: AgentStorage;
  workspaceRegistry: Pick<WorkspaceRegistry, "get">;
  projectRegistry?: Pick<ProjectRegistry, "get">;
  callerAgentId: string;
  roleId: PaseoRoleId;
}

function toolResult(payload: Record<string, unknown>): PaseoToolResult {
  return { content: [], structuredContent: ensureValidJson(payload) };
}

function assignmentHasExpired(assignment: PersistedAssignmentContract): boolean {
  const expiresAt = assignment.receipt.expiresAt;
  return expiresAt !== undefined && Date.parse(expiresAt) <= Date.now();
}

async function resolveCaller(options: RegisterBeadsToolsOptions): Promise<BeadsCaller> {
  const agent = await options.agentStorage.get(options.callerAgentId);
  if (!agent) throw new Error(`Caller agent ${options.callerAgentId} is unavailable`);
  const binding = agent.roleBinding;
  if (!binding) throw new Error("Beads Central tools require a durable Paseo role binding");
  if (binding.roleId !== options.roleId) {
    throw new Error("The caller role changed after its Beads Central tool catalog was created");
  }
  const assignment = binding.assignmentContract;
  if (!assignment) throw new Error("Beads Central tools require a durable assignment contract");
  if (assignmentHasExpired(assignment)) throw new Error("The caller assignment has expired");
  if (!agent.workspaceId) throw new Error("Beads Central tools require a current workspace");
  const workspace = await options.workspaceRegistry.get(agent.workspaceId);
  if (!workspace || workspace.archivedAt) {
    throw new Error(`Workspace ${agent.workspaceId} is unavailable or archived`);
  }
  if (options.projectRegistry) {
    const project = await options.projectRegistry.get(workspace.projectId);
    if (!project || project.archivedAt) {
      throw new Error(`Project ${workspace.projectId} is unavailable or archived`);
    }
  }
  return {
    roleId: binding.roleId,
    assignment,
    project: {
      projectId: workspace.projectId,
      actor: beadsActorForAgent(agent.id),
    },
  };
}

function requireWriteAuthority(caller: BeadsCaller): void {
  if (caller.roleId === "supervisor") {
    throw new Error("A role-bound Supervisor may inspect Beads but cannot mutate it");
  }
  if (caller.assignment.envelope.effectClass === "read-only") {
    throw new Error("The current read-only assignment cannot mutate Beads");
  }
  if (caller.assignment.envelope.externalEffectBoundary.mode !== "bounded") {
    throw new Error("Beads mutation requires a bounded external-effect assignment");
  }
  if (caller.roleId === "peer" && caller.assignment.envelope.effectClass !== "mutating") {
    throw new Error("A Peer needs a mutating assignment to update Beads");
  }
}

function requirePeerIssueGrant(caller: BeadsCaller, issueId: string): void {
  if (caller.roleId !== "peer") return;
  const grants = caller.assignment.envelope.resourceGrants?.beadsIssueIds ?? [];
  if (!grants.includes(issueId)) {
    throw new Error(`Peer assignment does not grant Beads issue ${issueId}`);
  }
}

function peerMutationGuard(
  caller: BeadsCaller,
  issueId: string,
  signal?: AbortSignal,
): BeadsMutationGuard | undefined {
  if (caller.roleId !== "peer") return undefined;
  return {
    kind: "owned-mutation",
    issueId,
    actor: caller.project.actor,
    requireNotClosed: true,
    ...(signal ? { signal } : {}),
  };
}

function peerClaimGuard(
  caller: BeadsCaller,
  issueId: string,
  signal?: AbortSignal,
): BeadsMutationGuard | undefined {
  if (caller.roleId !== "peer") return undefined;
  return {
    kind: "claim",
    issueId,
    actor: caller.project.actor,
    requireNotClosed: true,
    ...(signal ? { signal } : {}),
  };
}

const UpdateInputSchema = z
  .object({
    issueId: IssueIdSchema,
    title: TitleSchema.optional(),
    description: LongTextSchema.optional(),
    priority: PrioritySchema.optional(),
    status: BeadsWritableIssueStatusSchema.optional(),
    appendNotes: LongTextSchema.optional(),
    addLabels: z.array(LabelSchema).max(32).optional(),
    removeLabels: z.array(LabelSchema).max(32).optional(),
    idempotencyKey: IdempotencyKeySchema,
  })
  .strict()
  .refine(
    (input) =>
      input.title !== undefined ||
      input.description !== undefined ||
      input.priority !== undefined ||
      input.status !== undefined ||
      input.appendNotes !== undefined ||
      input.addLabels !== undefined ||
      input.removeLabels !== undefined,
    { message: "beads_update requires at least one field to update" },
  );

export function registerBeadsTools(options: RegisterBeadsToolsOptions): void {
  options.registerTool(
    "beads_status",
    {
      title: "Inspect Beads Central",
      description: "Check whether Paseo's mandatory Beads Central tracker is available.",
      inputSchema: z.object({}).strict(),
    },
    async () => toolResult({ ...(await options.service.status()) }),
  );

  options.registerTool(
    "beads_ready",
    {
      title: "List ready issues",
      description: "List unblocked issues in the durable graph for the caller's current project.",
      inputSchema: z.object({ limit: z.number().int().positive().max(100).default(20) }).strict(),
    },
    async ({ limit }, execution) => {
      const caller = await resolveCaller(options);
      const issues = await options.service.ready(caller.project, limit, execution.signal);
      return toolResult({ projectId: caller.project.projectId, issues });
    },
  );

  options.registerTool(
    "beads_list",
    {
      title: "List issues",
      description: "Query the durable issue graph for the caller's current Paseo project.",
      inputSchema: z
        .object({
          status: z.array(BeadsIssueStatusSchema).max(5).optional(),
          issueType: BeadsIssueTypeSchema.optional(),
          priority: PrioritySchema.optional(),
          assignee: z.string().trim().min(1).max(128).optional(),
          labels: z.array(LabelSchema).max(16).optional(),
          limit: z.number().int().positive().max(100).default(50),
        })
        .strict(),
    },
    async (input, execution) => {
      const caller = await resolveCaller(options);
      const issues = await options.service.list(caller.project, input, execution.signal);
      return toolResult({ projectId: caller.project.projectId, issues });
    },
  );

  options.registerTool(
    "beads_get",
    {
      title: "Inspect issue",
      description: "Read one issue and its current dependency metadata from the project graph.",
      inputSchema: z.object({ issueId: IssueIdSchema }).strict(),
    },
    async ({ issueId }, execution) => {
      const caller = await resolveCaller(options);
      const issue = await options.service.get(caller.project, issueId, execution.signal);
      return toolResult({ projectId: caller.project.projectId, issue });
    },
  );

  if (options.roleId !== "supervisor") {
    options.registerTool(
      "beads_create",
      {
        title: "Create issue",
        description:
          "Create a durable project issue. A Peer must link it to the issue that exposed it with discoveredFrom.",
        inputSchema: z
          .object({
            title: TitleSchema,
            description: LongTextSchema.optional(),
            issueType: BeadsIssueTypeSchema.default("task"),
            priority: PrioritySchema.default(2),
            labels: z.array(LabelSchema).max(32).optional(),
            acceptance: LongTextSchema.optional(),
            discoveredFrom: IssueIdSchema.optional(),
            idempotencyKey: IdempotencyKeySchema,
          })
          .strict(),
      },
      async (input, execution) => {
        const caller = await resolveCaller(options);
        requireWriteAuthority(caller);
        if (caller.roleId === "peer" && !input.discoveredFrom) {
          throw new Error("A Peer-created issue must include discoveredFrom");
        }
        if (caller.roleId === "peer" && input.discoveredFrom) {
          requirePeerIssueGrant(caller, input.discoveredFrom);
        }
        const issue = await options.service.create(
          caller.project,
          input,
          execution.signal,
          input.discoveredFrom
            ? peerMutationGuard(caller, input.discoveredFrom, execution.signal)
            : undefined,
        );
        return toolResult({ projectId: caller.project.projectId, issue });
      },
    );

    options.registerTool(
      "beads_claim",
      {
        title: "Claim issue",
        description: "Atomically assign an open issue to the calling Paseo agent and start it.",
        inputSchema: z
          .object({ issueId: IssueIdSchema, idempotencyKey: IdempotencyKeySchema })
          .strict(),
      },
      async ({ issueId, idempotencyKey }, execution) => {
        const caller = await resolveCaller(options);
        requireWriteAuthority(caller);
        requirePeerIssueGrant(caller, issueId);
        const issue = await options.service.claim(
          caller.project,
          issueId,
          idempotencyKey,
          execution.signal,
          peerClaimGuard(caller, issueId, execution.signal),
        );
        if (issue.assignee !== caller.project.actor) {
          throw new Error(`Issue ${issueId} was not claimed by ${caller.project.actor}`);
        }
        return toolResult({ projectId: caller.project.projectId, issue });
      },
    );

    options.registerTool(
      "beads_update",
      {
        title: "Update issue",
        description:
          "Update issue evidence or lifecycle fields. A Peer may update only its currently assigned issue.",
        inputSchema: UpdateInputSchema,
      },
      async ({ issueId, ...input }, execution) => {
        const caller = await resolveCaller(options);
        requireWriteAuthority(caller);
        requirePeerIssueGrant(caller, issueId);
        const issue = await options.service.update(
          caller.project,
          issueId,
          input,
          execution.signal,
          peerMutationGuard(caller, issueId, execution.signal),
        );
        return toolResult({ projectId: caller.project.projectId, issue });
      },
    );
  }

  if (options.roleId === "lead") {
    options.registerTool(
      "beads_close",
      {
        title: "Close issue",
        description:
          "Close an issue with an evidence-based reason. Binding closure remains Lead-owned; Peers hand back instead.",
        inputSchema: z
          .object({
            issueId: IssueIdSchema,
            reason: z.string().trim().min(1).max(10_000),
            idempotencyKey: IdempotencyKeySchema,
          })
          .strict(),
      },
      async ({ issueId, reason, idempotencyKey }, execution) => {
        const caller = await resolveCaller(options);
        requireWriteAuthority(caller);
        if (caller.roleId !== "lead")
          throw new Error("Only the role-bound Lead may close an issue");
        const issue = await options.service.close(
          caller.project,
          issueId,
          reason,
          idempotencyKey,
          execution.signal,
        );
        return toolResult({ projectId: caller.project.projectId, issue });
      },
    );
  }

  if (options.roleId !== "supervisor") {
    options.registerTool(
      "beads_add_dependency",
      {
        title: "Add issue dependency",
        description:
          "Add one typed dependency edge. A Peer may change only the graph rooted at its assigned issue.",
        inputSchema: z
          .object({
            issueId: IssueIdSchema,
            dependsOnId: IssueIdSchema,
            dependencyType: BeadsDependencyTypeSchema.default("blocks"),
            idempotencyKey: IdempotencyKeySchema,
          })
          .strict()
          .refine((input) => input.issueId !== input.dependsOnId, {
            message: "An issue cannot depend on itself",
          }),
      },
      async ({ issueId, dependsOnId, dependencyType, idempotencyKey }, execution) => {
        const caller = await resolveCaller(options);
        requireWriteAuthority(caller);
        requirePeerIssueGrant(caller, issueId);
        const updated = await options.service.addDependency(
          caller.project,
          issueId,
          dependsOnId,
          dependencyType,
          idempotencyKey,
          execution.signal,
          peerMutationGuard(caller, issueId, execution.signal),
        );
        return toolResult({ projectId: caller.project.projectId, issue: updated });
      },
    );
  }

  options.registerTool(
    "beads_prime",
    {
      title: "Read Beads workflow context",
      description: "Return compact, no-git Beads workflow guidance for the current project.",
      inputSchema: z.object({}).strict(),
    },
    async (_input, execution) => {
      const caller = await resolveCaller(options);
      const instructions = await options.service.prime(caller.project, execution.signal);
      return toolResult({ projectId: caller.project.projectId, instructions });
    },
  );
}
