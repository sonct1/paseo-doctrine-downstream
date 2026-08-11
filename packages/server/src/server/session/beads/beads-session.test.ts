import { describe, expect, it, vi } from "vitest";

import type { SessionOutboundMessage } from "@getpaseo/protocol/messages";

import type { BeadsNativeService } from "../../beads/beads-native-service.js";
import { BeadsSession } from "./beads-session.js";

function issue() {
  return {
    id: "ps123-abc",
    title: "Native issue",
    status: "open" as const,
    priority: 2,
    issue_type: "task" as const,
  };
}

function harness(
  options: {
    projectActive?: boolean;
    runtimeAvailable?: boolean;
    listedIssues?: ReturnType<typeof issue>[];
  } = {},
) {
  const messages: SessionOutboundMessage[] = [];
  const service = {
    status: vi
      .fn()
      .mockResolvedValue(
        options.runtimeAvailable === false
          ? { available: false, version: "1.1.2", reason: "missing runtime" }
          : { available: true, version: "1.1.2" },
      ),
    list: vi.fn().mockResolvedValue(options.listedIssues ?? [issue()]),
    get: vi.fn().mockResolvedValue(issue()),
    create: vi.fn().mockResolvedValue(issue()),
    close: vi.fn().mockResolvedValue({ ...issue(), status: "closed" }),
  };
  const session = new BeadsSession({
    host: { emit: (message) => messages.push(message) },
    service: service as unknown as BeadsNativeService,
    projectRegistry: {
      get: vi
        .fn()
        .mockResolvedValue(
          options.projectActive === false ? null : { projectId: "project-1", archivedAt: null },
        ),
    },
    clientId: "human-client",
  });
  return { session, service, messages };
}

describe("BeadsSession", () => {
  it("returns runtime unavailability without initializing a project graph", async () => {
    const test = harness({ runtimeAvailable: false });

    await test.session.handleList({
      type: "beads.issues.list.request",
      requestId: "list-1",
      projectId: "project-1",
    });

    expect(test.service.list).not.toHaveBeenCalled();
    expect(test.messages).toEqual([
      {
        type: "beads.issues.list.response",
        payload: {
          requestId: "list-1",
          projectId: "project-1",
          runtime: { available: false, version: "1.1.2", reason: "missing runtime" },
          issues: [],
          truncated: false,
          error: "missing runtime",
        },
      },
    ]);
  });

  it("filters in Beads and reports when the requested window is truncated", async () => {
    const listedIssues = Array.from({ length: 101 }, (_, index) => ({
      ...issue(),
      id: `ps123-${index.toString().padStart(3, "0")}`,
      status: "closed" as const,
    }));
    const test = harness({ listedIssues });

    await test.session.handleList({
      type: "beads.issues.list.request",
      requestId: "list-closed",
      projectId: "project-1",
      status: ["closed"],
      limit: 100,
    });

    expect(test.service.list).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-1" }),
      { status: ["closed"], limit: 101 },
    );
    expect(test.messages.at(-1)).toMatchObject({
      type: "beads.issues.list.response",
      payload: {
        projectId: "project-1",
        issues: listedIssues.slice(0, 100),
        truncated: true,
        error: null,
      },
    });
  });

  it("does not report truncation when the requested window is complete", async () => {
    const listedIssues = Array.from({ length: 100 }, (_, index) => ({
      ...issue(),
      id: `ps123-${index.toString().padStart(3, "0")}`,
    }));
    const test = harness({ listedIssues });

    await test.session.handleList({
      type: "beads.issues.list.request",
      requestId: "list-complete",
      projectId: "project-1",
      limit: 100,
    });

    expect(test.messages.at(-1)).toMatchObject({
      type: "beads.issues.list.response",
      payload: { issues: listedIssues, truncated: false, error: null },
    });
  });

  it("rejects a client-selected archived or unknown project", async () => {
    const test = harness({ projectActive: false });

    await test.session.handleCreate({
      type: "beads.issue.create.request",
      requestId: "create-1",
      projectId: "unknown",
      title: "Issue",
      issueType: "task",
      priority: 2,
      idempotencyKey: "create-issue",
    });

    expect(test.service.create).not.toHaveBeenCalled();
    expect(test.messages.at(-1)).toMatchObject({
      type: "beads.issue.create.response",
      payload: { issue: null, error: "Project unknown is unavailable or archived" },
    });
  });

  it("uses a daemon-derived Human actor for create and close", async () => {
    const test = harness();

    await test.session.handleCreate({
      type: "beads.issue.create.request",
      requestId: "create-1",
      projectId: "project-1",
      title: "Native issue",
      issueType: "task",
      priority: 2,
      idempotencyKey: "create-issue",
    });
    await test.session.handleClose({
      type: "beads.issue.close.request",
      requestId: "close-1",
      projectId: "project-1",
      issueId: "ps123-abc",
      reason: "Accepted",
      idempotencyKey: "close-issue",
    });

    const createContext = test.service.create.mock.calls[0]?.[0];
    const closeContext = test.service.close.mock.calls[0]?.[0];
    expect(createContext).toMatchObject({
      projectId: "project-1",
      actor: expect.stringMatching(/^paseo-human-[a-f0-9]{12}$/u),
    });
    expect(closeContext).toEqual(createContext);
    expect(test.messages.map((message) => message.type)).toEqual([
      "beads.issue.create.response",
      "beads.issue.close.response",
    ]);
  });

  it("reads one authoritative issue from the selected project", async () => {
    const test = harness();

    await test.session.handleGet({
      type: "beads.issue.get.request",
      requestId: "get-1",
      projectId: "project-1",
      issueId: "ps123-abc",
    });

    expect(test.service.get).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-1" }),
      "ps123-abc",
    );
    expect(test.messages.at(-1)).toMatchObject({
      type: "beads.issue.get.response",
      payload: { projectId: "project-1", issue: { id: "ps123-abc" }, error: null },
    });
  });
});
