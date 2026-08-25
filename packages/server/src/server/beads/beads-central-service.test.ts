import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import type { PersistedProjectRecord } from "../workspace-registry.js";
import { BeadsCentralService } from "./beads-central-service.js";
import { deriveWorkGraphId, deriveWorkGraphPrefix } from "./beads-service.js";

const token = "central-test-token-000000000000000000000";

function issue(overrides: Record<string, unknown> = {}) {
  return {
    id: "ps123-abc",
    title: "Central issue",
    status: "open",
    priority: 2,
    issue_type: "task",
    assignee: null,
    ...overrides,
  };
}

function project(overrides: Partial<PersistedProjectRecord> = {}): PersistedProjectRecord {
  return {
    projectId: "project-local-1",
    rootPath: "/work/repo",
    kind: "git",
    displayName: "owner/repo",
    projectKey: "remote:github.com/owner/repo",
    workGraphId: null,
    customName: null,
    customIconRevision: null,
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
    archivedAt: null,
    ...overrides,
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createHarness(
  options: {
    project?: PersistedProjectRecord;
    credential?: string | null;
    centralVersion?: string;
  } = {},
) {
  let currentProject = options.project ?? project();
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const request = init ?? {};
    calls.push({ url, init: request });
    if (request.signal?.aborted) {
      throw request.signal.reason;
    }
    const parsed = new URL(url);
    if (parsed.pathname === "/health/ready") {
      return json({
        status: "ready",
        central: options.centralVersion ?? "1.2.0",
        bd: "bd version 1.1.2 (v1.1.2-bundled)",
        projects: 0,
      });
    }
    if (parsed.pathname === "/v1/projects") return json({ projects: [] });
    if (request.method === "PUT" && parsed.pathname.startsWith("/v1/admin/projects/")) {
      return json({ result: { project: {}, created: true } });
    }
    if (parsed.pathname.endsWith("/issues") && request.method === "POST") {
      return json({ result: issue() }, 201);
    }
    if (parsed.pathname.endsWith("/issues")) return json({ result: [issue()] });
    if (parsed.pathname.endsWith("/ready")) return json({ result: [issue()] });
    if (parsed.pathname.endsWith("/prime")) return json({ result: "workflow" });
    if (parsed.pathname.includes("/issues/")) return json({ result: issue() });
    return json({ detail: "unexpected route" }, 404);
  });
  const registry = {
    get: vi.fn(async () => currentProject),
    update: vi.fn(
      async (
        _projectId: string,
        updater: (record: PersistedProjectRecord) => PersistedProjectRecord,
      ) => {
        currentProject = updater(currentProject);
        return currentProject;
      },
    ),
  };
  const service = new BeadsCentralService({
    logger: createTestLogger(),
    getConfig: () => ({
      endpoint: "http://127.0.0.1:8080",
      credentialRef: "beads-central",
    }),
    credentialStore: {
      readApiKeyForInternalUse: vi.fn(() =>
        options.credential === undefined ? token : options.credential,
      ),
    },
    projectRegistry: registry,
    fetchImpl: fetchImpl as typeof fetch,
  });
  return { service, calls, registry, getProject: () => currentProject };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("BeadsCentralService", () => {
  it("qualifies the exact Central and Beads versions with the service credential", async () => {
    const harness = createHarness();
    await expect(harness.service.status()).resolves.toEqual({
      available: true,
      version: "1.2.0",
    });
    expect(harness.calls).toHaveLength(2);
    expect(new Headers(harness.calls[1]?.init.headers).get("authorization")).toBe(
      `Bearer ${token}`,
    );
    expect(new Headers(harness.calls[1]?.init.headers).get("x-paseo-actor")).toBe(
      "paseo-daemon-status",
    );
  });

  it("applies a caller health deadline to every Central qualification request", async () => {
    const harness = createHarness();
    const controller = new AbortController();
    controller.abort(new Error("health deadline reached"));
    await expect(harness.service.status(controller.signal)).resolves.toMatchObject({
      available: false,
      reason: expect.stringContaining("health deadline reached"),
    });
    expect(harness.calls).toHaveLength(1);
    const call = harness.calls[0];
    if (!call) throw new Error("Expected one Central request");
    expect((call.init.signal as AbortSignal).aborted).toBe(true);
  });

  it("fails closed for a missing credential or wrong Central version", async () => {
    await expect(createHarness({ credential: null }).service.status()).resolves.toMatchObject({
      available: false,
      reason: expect.stringContaining("is not configured"),
    });
    await expect(
      createHarness({ centralVersion: "1.1.0" }).service.status(),
    ).resolves.toMatchObject({
      available: false,
      reason: expect.stringContaining("requires Beads Central 1.2.0"),
    });
  });

  it("mints one durable workGraphId, registers it, and never sends the Paseo project ID", async () => {
    const harness = createHarness();
    const context = { projectId: "project-local-1", actor: "paseo-agent-lead-1" };
    await harness.service.create(context, {
      title: "Central issue",
      issueType: "task",
      priority: 2,
      idempotencyKey: "create-central-0001",
    });

    const expectedId = deriveWorkGraphId("remote:github.com/owner/repo");
    expect(harness.getProject().workGraphId).toBe(expectedId);
    expect(harness.registry.update).toHaveBeenCalledOnce();
    const ensure = harness.calls.find((call) => call.init.method === "PUT");
    expect(ensure?.url).toBe(`http://127.0.0.1:8080/v1/admin/projects/${expectedId}`);
    expect(JSON.parse(String(ensure?.init.body))).toEqual({
      prefix: deriveWorkGraphPrefix(expectedId),
      description: "owner/repo",
    });
    const mutation = harness.calls.find((call) => call.init.method === "POST");
    expect(mutation?.url).toContain(`/v1/projects/${expectedId}/issues`);
    expect(mutation?.url).not.toContain("project-local-1");
    expect(new Headers(mutation?.init.headers).get("x-paseo-actor")).toBe("paseo-agent-lead-1");
  });

  it("preserves an existing workGraphId when projectKey later changes", async () => {
    const stable = deriveWorkGraphId("original-key");
    const harness = createHarness({
      project: project({ projectKey: "changed-key", workGraphId: stable }),
    });
    await harness.service.list(
      { projectId: "project-local-1", actor: "paseo-agent-supervisor" },
      { limit: 10 },
    );
    expect(harness.registry.update).not.toHaveBeenCalled();
    expect(harness.calls.some((call) => call.url.includes(stable))).toBe(true);
  });

  it("forwards a Peer guard without trusting a caller-selected actor", async () => {
    const harness = createHarness({
      project: project({ workGraphId: deriveWorkGraphId("stable") }),
    });
    const context = { projectId: "project-local-1", actor: "paseo-agent-peer-1" };
    await harness.service.update(
      context,
      "ps123-abc",
      { appendNotes: "evidence", idempotencyKey: "update-central-0001" },
      undefined,
      {
        kind: "owned-mutation",
        issueId: "ps123-abc",
        actor: context.actor,
        requireNotClosed: true,
      },
    );
    const mutation = harness.calls.find((call) => call.init.method === "PATCH");
    expect(JSON.parse(String(mutation?.init.body))).toMatchObject({
      append_notes: "evidence",
      idempotency_key: "update-central-0001",
      guard: {
        kind: "owned-mutation",
        issue_id: "ps123-abc",
        require_not_closed: true,
      },
    });
    await expect(
      harness.service.update(
        context,
        "ps123-abc",
        { appendNotes: "bad", idempotencyKey: "update-central-0002" },
        undefined,
        {
          kind: "owned-mutation",
          issueId: "ps123-abc",
          actor: "paseo-agent-peer-other",
          requireNotClosed: true,
        },
      ),
    ).rejects.toThrow("guard actor does not match");
  });
});
