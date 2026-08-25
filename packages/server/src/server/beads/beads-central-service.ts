import type { Logger } from "pino";
import { z } from "zod";

import type { FoundationCredentialStore } from "../foundation-credential-store.js";
import {
  resolveProjectDisplayName,
  type PersistedProjectRecord,
  type ProjectRegistry,
} from "../workspace-registry.js";
import {
  BeadsIssueSchema,
  PASEO_BEADS_CENTRAL_VERSION,
  deriveWorkGraphId,
  deriveWorkGraphPrefix,
  type BeadsCreateInput,
  type BeadsIssue,
  type BeadsListInput,
  type BeadsMutationGuard,
  type BeadsProjectContext,
  type BeadsRuntimeStatus,
  type BeadsService,
  type BeadsUpdateInput,
  BeadsDependencyTypeSchema,
} from "./beads-service.js";

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const WorkGraphIdSchema = z.string().regex(/^pg-[a-f0-9]{32}$/u);
const ReadyResponseSchema = z.object({
  status: z.literal("ready"),
  central: z.string(),
  bd: z.string(),
});
const ResultEnvelopeSchema = z.object({ result: z.unknown() });

export interface BeadsCentralConfig {
  endpoint: string;
  credentialRef: string;
}

export interface BeadsCentralServiceOptions {
  logger: Logger;
  getConfig: () => BeadsCentralConfig;
  credentialStore: Pick<FoundationCredentialStore, "readApiKeyForInternalUse">;
  projectRegistry: Pick<ProjectRegistry, "get" | "update">;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
}

interface CentralProjectBinding {
  paseoProject: PersistedProjectRecord;
  workGraphId: string;
  prefix: string;
}

function normalizeEndpoint(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Beads Central endpoint must use http or https");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Beads Central endpoint must not contain credentials, query, or fragment");
  }
  url.pathname = url.pathname.replace(/\/+$/u, "");
  return url.toString().replace(/\/$/u, "");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveRequestToken(
  path: string,
  config: BeadsCentralConfig,
  credentialStore: Pick<FoundationCredentialStore, "readApiKeyForInternalUse">,
): string | null {
  if (path === "/health/ready") return null;
  const token =
    process.env.PASEO_BEADS_CENTRAL_TOKEN?.trim() ||
    credentialStore.readApiKeyForInternalUse(config.credentialRef);
  if (!token) {
    throw new Error(`Beads Central credential '${config.credentialRef}' is not configured`);
  }
  return token;
}

async function parseCentralResponse(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error("Beads Central response exceeded the size limit");
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
    throw new Error("Beads Central response exceeded the size limit");
  }
  let body: unknown;
  try {
    body = text ? (JSON.parse(text) as unknown) : null;
  } catch (error) {
    throw new Error("Beads Central returned invalid JSON", { cause: error });
  }
  if (response.ok) return body;
  const detail = z.object({ detail: z.string() }).safeParse(body);
  const suffix = detail.success ? `: ${detail.data.detail}` : "";
  throw new Error(`Beads Central request failed (${response.status})${suffix}`);
}

function centralGuard(
  context: BeadsProjectContext,
  guard: BeadsMutationGuard | undefined,
): Record<string, unknown> | undefined {
  if (!guard) return undefined;
  if (guard.actor !== context.actor) {
    throw new Error("Beads mutation guard actor does not match the authenticated Paseo actor");
  }
  return {
    kind: guard.kind,
    issue_id: guard.issueId,
    require_not_closed: true,
  };
}

export class BeadsCentralService implements BeadsService {
  private readonly logger: Logger;
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;

  public constructor(private readonly options: BeadsCentralServiceOptions) {
    this.logger = options.logger.child({ module: "beads", component: "central-service" });
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  public async status(signal?: AbortSignal): Promise<BeadsRuntimeStatus> {
    try {
      const ready = ReadyResponseSchema.parse(await this.requestJson("/health/ready", { signal }));
      if (ready.central !== PASEO_BEADS_CENTRAL_VERSION) {
        throw new Error(
          `Paseo requires Beads Central ${PASEO_BEADS_CENTRAL_VERSION}; received ${ready.central}`,
        );
      }
      if (!ready.bd.startsWith("bd version 1.1.2")) {
        throw new Error(`Beads Central returned an unsupported runtime: ${ready.bd}`);
      }
      await this.requestJson("/v1/projects", { actor: "paseo-daemon-status", signal });
      return { available: true, version: PASEO_BEADS_CENTRAL_VERSION };
    } catch (error) {
      return {
        available: false,
        version: PASEO_BEADS_CENTRAL_VERSION,
        reason: errorMessage(error),
      };
    }
  }

  public async ready(
    context: BeadsProjectContext,
    limit = 20,
    signal?: AbortSignal,
  ): Promise<BeadsIssue[]> {
    const binding = await this.ensureProject(context, signal);
    const query = new URLSearchParams({ limit: String(limit) });
    return this.issueList(
      `/v1/projects/${binding.workGraphId}/ready?${query.toString()}`,
      context.actor,
      signal,
    );
  }

  public async list(
    context: BeadsProjectContext,
    input: BeadsListInput,
    signal?: AbortSignal,
  ): Promise<BeadsIssue[]> {
    const binding = await this.ensureProject(context, signal);
    const query = new URLSearchParams({ limit: String(input.limit ?? 50) });
    if (input.status?.length) query.set("status_filter", input.status.join(","));
    if (input.issueType) query.set("issue_type", input.issueType);
    if (input.priority !== undefined) query.set("priority", String(input.priority));
    if (input.assignee) query.set("assignee", input.assignee);
    for (const label of input.labels ?? []) query.append("label", label);
    return this.issueList(
      `/v1/projects/${binding.workGraphId}/issues?${query.toString()}`,
      context.actor,
      signal,
    );
  }

  public async get(
    context: BeadsProjectContext,
    issueId: string,
    signal?: AbortSignal,
  ): Promise<BeadsIssue> {
    const binding = await this.ensureProject(context, signal);
    return this.issueResult(
      `/v1/projects/${binding.workGraphId}/issues/${encodeURIComponent(issueId)}`,
      context.actor,
      undefined,
      signal,
    );
  }

  public async create(
    context: BeadsProjectContext,
    input: BeadsCreateInput,
    signal?: AbortSignal,
    guard?: BeadsMutationGuard,
  ): Promise<BeadsIssue> {
    const binding = await this.ensureProject(context, signal);
    return this.issueResult(
      `/v1/projects/${binding.workGraphId}/issues`,
      context.actor,
      {
        method: "POST",
        body: {
          title: input.title,
          description: input.description,
          acceptance: input.acceptance,
          issue_type: input.issueType,
          priority: input.priority,
          labels: input.labels,
          discovered_from: input.discoveredFrom,
          guard: centralGuard(context, guard),
          idempotency_key: input.idempotencyKey,
        },
      },
      signal,
    );
  }

  public async claim(
    context: BeadsProjectContext,
    issueId: string,
    idempotencyKey: string,
    signal?: AbortSignal,
    guard?: BeadsMutationGuard,
  ): Promise<BeadsIssue> {
    const binding = await this.ensureProject(context, signal);
    return this.issueResult(
      `/v1/projects/${binding.workGraphId}/issues/${encodeURIComponent(issueId)}/claim`,
      context.actor,
      {
        method: "POST",
        body: {
          guard: centralGuard(context, guard),
          idempotency_key: idempotencyKey,
        },
      },
      signal,
    );
  }

  public async update(
    context: BeadsProjectContext,
    issueId: string,
    input: BeadsUpdateInput,
    signal?: AbortSignal,
    guard?: BeadsMutationGuard,
  ): Promise<BeadsIssue> {
    const binding = await this.ensureProject(context, signal);
    return this.issueResult(
      `/v1/projects/${binding.workGraphId}/issues/${encodeURIComponent(issueId)}`,
      context.actor,
      {
        method: "PATCH",
        body: {
          title: input.title,
          description: input.description,
          priority: input.priority,
          status: input.status,
          append_notes: input.appendNotes,
          add_labels: input.addLabels,
          remove_labels: input.removeLabels,
          guard: centralGuard(context, guard),
          idempotency_key: input.idempotencyKey,
        },
      },
      signal,
    );
  }

  public async close(
    context: BeadsProjectContext,
    issueId: string,
    reason: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<BeadsIssue> {
    const binding = await this.ensureProject(context, signal);
    return this.issueResult(
      `/v1/projects/${binding.workGraphId}/issues/${encodeURIComponent(issueId)}/close`,
      context.actor,
      { method: "POST", body: { reason, idempotency_key: idempotencyKey } },
      signal,
    );
  }

  public async addDependency(
    context: BeadsProjectContext,
    issueId: string,
    dependsOnId: string,
    dependencyType: z.infer<typeof BeadsDependencyTypeSchema>,
    idempotencyKey: string,
    signal?: AbortSignal,
    guard?: BeadsMutationGuard,
  ): Promise<BeadsIssue> {
    const binding = await this.ensureProject(context, signal);
    return this.issueResult(
      `/v1/projects/${binding.workGraphId}/issues/${encodeURIComponent(issueId)}/dependencies`,
      context.actor,
      {
        method: "POST",
        body: {
          depends_on: dependsOnId,
          dependency_type: dependencyType,
          guard: centralGuard(context, guard),
          idempotency_key: idempotencyKey,
        },
      },
      signal,
    );
  }

  public async prime(context: BeadsProjectContext, signal?: AbortSignal): Promise<string> {
    const binding = await this.ensureProject(context, signal);
    const value = await this.result(
      `/v1/projects/${binding.workGraphId}/prime`,
      context.actor,
      undefined,
      signal,
    );
    return z.string().parse(value);
  }

  private async issueList(
    path: string,
    actor: string,
    signal?: AbortSignal,
  ): Promise<BeadsIssue[]> {
    return z.array(BeadsIssueSchema).parse(await this.result(path, actor, undefined, signal));
  }

  private async issueResult(
    path: string,
    actor: string,
    request?: { method: "POST" | "PUT" | "PATCH"; body: Record<string, unknown> },
    signal?: AbortSignal,
  ): Promise<BeadsIssue> {
    return BeadsIssueSchema.parse(await this.result(path, actor, request, signal));
  }

  private async result(
    path: string,
    actor: string,
    request?: { method: "POST" | "PUT" | "PATCH"; body: Record<string, unknown> },
    signal?: AbortSignal,
  ): Promise<unknown> {
    const response = await this.requestJson(path, {
      actor,
      method: request?.method,
      body: request?.body,
      signal,
    });
    return ResultEnvelopeSchema.parse(response).result;
  }

  private async ensureProject(
    context: BeadsProjectContext,
    signal?: AbortSignal,
  ): Promise<CentralProjectBinding> {
    const binding = await this.resolveProjectBinding(context.projectId);
    await this.result(
      `/v1/admin/projects/${binding.workGraphId}`,
      context.actor,
      {
        method: "PUT",
        body: {
          prefix: binding.prefix,
          description: resolveProjectDisplayName(binding.paseoProject),
        },
      },
      signal,
    );
    return binding;
  }

  private async resolveProjectBinding(projectId: string): Promise<CentralProjectBinding> {
    let project = await this.options.projectRegistry.get(projectId);
    if (!project || project.archivedAt) {
      throw new Error(`Project ${projectId} is unavailable or archived`);
    }
    let workGraphId = project.workGraphId;
    if (!workGraphId) {
      const seed = project.projectKey ?? `paseo-project:${project.projectId}`;
      const proposed = deriveWorkGraphId(seed);
      const updated = await this.options.projectRegistry.update(projectId, (current) => ({
        ...current,
        workGraphId: current.workGraphId ?? proposed,
      }));
      if (!updated) throw new Error(`Project ${projectId} disappeared during work-graph binding`);
      project = updated;
      workGraphId = updated.workGraphId;
    }
    const validWorkGraphId = WorkGraphIdSchema.parse(workGraphId);
    return {
      paseoProject: project,
      workGraphId: validWorkGraphId,
      prefix: deriveWorkGraphPrefix(validWorkGraphId),
    };
  }

  private async requestJson(
    path: string,
    options: {
      actor?: string;
      method?: "POST" | "PUT" | "PATCH";
      body?: Record<string, unknown>;
      signal?: AbortSignal;
    } = {},
  ): Promise<unknown> {
    const config = this.options.getConfig();
    const endpoint = normalizeEndpoint(config.endpoint);
    const token = resolveRequestToken(path, config, this.options.credentialStore);

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error("Beads Central request timed out")),
      this.requestTimeoutMs,
    );
    const abort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) {
      abort();
    } else {
      options.signal?.addEventListener("abort", abort, { once: true });
    }
    try {
      const response = await this.fetchImpl(`${endpoint}${path}`, {
        method: options.method ?? "GET",
        headers: {
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(options.actor ? { "X-Paseo-Actor": options.actor } : {}),
          ...(options.body ? { "Content-Type": "application/json" } : {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        signal: controller.signal,
      });
      return await parseCentralResponse(response);
    } catch (error) {
      this.logger.debug({ err: error, path }, "Beads Central request failed");
      throw error;
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
    }
  }
}
