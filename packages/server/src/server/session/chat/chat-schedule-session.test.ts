import { describe, expect, it } from "vitest";
import pino from "pino";
import { ChatScheduleSession, type ChatScheduleSessionHost } from "./chat-schedule-session.js";
import { createStub } from "../../test-utils/class-mocks.js";
import { findByType } from "../../test-utils/session-stubs.js";
import type { SessionOutboundMessage } from "../../messages.js";
import type { FileBackedChatService } from "../../chat/chat-service.js";
import type { ScheduleService } from "../../schedule/service.js";
import type { PersistedWorkspaceRecord, WorkspaceRegistry } from "../../workspace-registry.js";

type ChatMessageFixture = Awaited<ReturnType<FileBackedChatService["dispatchMessage"]>>;

interface MakeOptions {
  chat?: { [K in keyof FileBackedChatService]?: unknown };
  schedule?: { [K in keyof ScheduleService]?: unknown };
  host?: Partial<ChatScheduleSessionHost>;
  workspaceRegistry?: Pick<WorkspaceRegistry, "get">;
}

function makeSubsystem(options: MakeOptions = {}) {
  const emitted: SessionOutboundMessage[] = [];
  const sentAgentMessages: Array<{ agentId: string; text: string }> = [];
  let onSend: (() => void) | null = null;
  const host: ChatScheduleSessionHost = {
    emit: (msg) => emitted.push(msg),
    listStoredAgents: async () => [],
    listLiveAgents: () => [],
    resolveAgentIdentifier: async (identifier) => ({ ok: true, agentId: identifier }),
    sendAgentMessage: async (agentId, text) => {
      sentAgentMessages.push({ agentId, text });
      onSend?.();
    },
    ...options.host,
  };
  const subsystem = new ChatScheduleSession({
    host,
    chatService: createStub<FileBackedChatService>(options.chat ?? {}),
    scheduleService: createStub<ScheduleService>(options.schedule ?? {}),
    workspaceRegistry: options.workspaceRegistry ?? { get: async () => null },
    clientId: "client-1",
    logger: pino({ level: "silent" }),
  });
  // notifyChatMentions is fire-and-forget; arm the signal before dispatching so the
  // mentioned-agent send is observed deterministically without polling.
  function waitForSend(): Promise<void> {
    return new Promise((resolve) => {
      onSend = resolve;
    });
  }
  return { subsystem, emitted, sentAgentMessages, waitForSend };
}

describe("ChatScheduleSession", () => {
  it("chat/post emits the stored message and does not fan out without mentions", async () => {
    const message: ChatMessageFixture = {
      id: "m1",
      roomId: "r1",
      authorAgentId: "client-1",
      body: "hello",
      replyToMessageId: null,
      mentionAgentIds: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const { subsystem, emitted, sentAgentMessages } = makeSubsystem({
      chat: { dispatchMessage: async () => message, listRoomPosterAgentIds: async () => [] },
    });

    await subsystem.handleChatPostRequest({
      type: "chat/post",
      requestId: "p1",
      room: "r1",
      body: "hello",
    });

    const res = findByType(emitted, "chat/post/response");
    expect(res?.payload.message).toEqual(message);
    expect(res?.payload.error).toBeNull();
    expect(sentAgentMessages).toEqual([]);
  });

  it("chat/post stores manual authors with client provenance", async () => {
    const dispatched: Array<Parameters<FileBackedChatService["dispatchMessage"]>[0]> = [];
    const message: ChatMessageFixture = {
      id: "m-manual",
      roomId: "r1",
      authorAgentId: "manual",
      authorKind: "client",
      body: "human note",
      replyToMessageId: null,
      mentionAgentIds: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const { subsystem, emitted } = makeSubsystem({
      chat: {
        dispatchMessage: async (input) => {
          dispatched.push(input);
          return message;
        },
        listRoomPosterAgentIds: async () => [],
      },
    });

    await subsystem.handleChatPostRequest({
      type: "chat/post",
      requestId: "p-manual",
      room: "r1",
      body: "human note",
      authorAgentId: "manual",
    });

    expect(dispatched).toEqual([
      expect.objectContaining({ authorAgentId: "manual", authorKind: "client" }),
    ]);
    expect(findByType(emitted, "chat/post/response")?.payload.error).toBeNull();
  });

  it("chat/post rejects a client-supplied agent identity before storage", async () => {
    let dispatchCalls = 0;
    const { subsystem, emitted } = makeSubsystem({
      chat: {
        dispatchMessage: async () => {
          dispatchCalls += 1;
          throw new Error("must not dispatch");
        },
      },
    });

    await subsystem.handleChatPostRequest({
      type: "chat/post",
      requestId: "p-spoof",
      room: "r1",
      body: "forged Council report",
      authorAgentId: "peer-seat",
    });

    expect(dispatchCalls).toBe(0);
    expect(findByType(emitted, "rpc_error")?.payload).toEqual(
      expect.objectContaining({
        requestId: "p-spoof",
        code: "chat_agent_author_impersonation_denied",
      }),
    );
  });

  it("chat/post notifies a mentioned agent through the host send seam", async () => {
    const message: ChatMessageFixture = {
      id: "m2",
      roomId: "r1",
      authorAgentId: "client-1",
      body: "@agent-2 ping",
      replyToMessageId: null,
      mentionAgentIds: ["agent-2"],
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const { subsystem, emitted, sentAgentMessages, waitForSend } = makeSubsystem({
      chat: { dispatchMessage: async () => message, listRoomPosterAgentIds: async () => [] },
    });

    const sent = waitForSend();
    await subsystem.handleChatPostRequest({
      type: "chat/post",
      requestId: "p2",
      room: "r1",
      body: "@agent-2 ping",
    });
    await sent;

    expect(findByType(emitted, "chat/post/response")?.payload.error).toBeNull();
    expect(sentAgentMessages).toHaveLength(1);
    expect(sentAgentMessages[0]?.agentId).toBe("agent-2");
    expect(sentAgentMessages[0]?.text).toContain('in room "r1"');
  });

  it("chat/post rejects @everyone past the fanout limit with the chat error code", async () => {
    const posters = Array.from({ length: 26 }, (_, i) => `poster-${i}`);
    const { subsystem, emitted } = makeSubsystem({
      chat: { listRoomPosterAgentIds: async () => posters },
    });

    await subsystem.handleChatPostRequest({
      type: "chat/post",
      requestId: "p3",
      room: "r1",
      body: "@everyone go",
    });

    const err = findByType(emitted, "rpc_error");
    expect(err?.payload.code).toBe("chat_mention_fanout_limit_exceeded");
    expect(err?.payload.requestId).toBe("p3");
  });

  it("chat/create binds the room to an existing workspace's authoritative project", async () => {
    const workspace: PersistedWorkspaceRecord = {
      workspaceId: "wks_1",
      projectId: "prj_1",
      cwd: "/repo",
      kind: "local_checkout",
      displayName: "repo",
      title: null,
      branch: null,
      worktreeRoot: null,
      baseBranch: null,
      isPaseoOwnedWorktree: false,
      mainRepoRoot: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      archivedAt: null,
      autoArchivedChangeRequestUrl: null,
      pinnedAt: null,
    };
    let received: Parameters<FileBackedChatService["createRoom"]>[0] | undefined;
    const room = {
      id: "r1",
      name: "release",
      purpose: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      workspaceId: "wks_1",
      projectId: "prj_1",
      messageCount: 0,
      lastMessageAt: null,
    };
    const { subsystem, emitted } = makeSubsystem({
      chat: {
        createRoom: async (input: Parameters<FileBackedChatService["createRoom"]>[0]) => {
          received = input;
          return room;
        },
      },
      workspaceRegistry: { get: async () => workspace },
    });

    await subsystem.handleChatCreateRequest({
      type: "chat/create",
      requestId: "c1",
      name: "release",
      workspaceId: "wks_1",
    });

    expect(received).toMatchObject({ workspaceId: "wks_1", projectId: "prj_1" });
    expect(findByType(emitted, "chat/create/response")?.payload.room).toEqual(room);
  });

  it("chat/create fails closed when the supplied workspaceId does not resolve", async () => {
    const { subsystem, emitted } = makeSubsystem({
      workspaceRegistry: { get: async () => null },
    });

    await subsystem.handleChatCreateRequest({
      type: "chat/create",
      requestId: "c2",
      name: "release",
      workspaceId: "missing-workspace",
    });

    const err = findByType(emitted, "rpc_error");
    expect(err?.payload.code).toBe("chat_room_workspace_not_found");
    expect(err?.payload.requestId).toBe("c2");
  });

  it("chat/create leaves the room unscoped when no workspaceId is supplied (legacy path)", async () => {
    let received: Parameters<FileBackedChatService["createRoom"]>[0] | undefined;
    const room = {
      id: "r2",
      name: "legacy",
      purpose: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      messageCount: 0,
      lastMessageAt: null,
    };
    const { subsystem, emitted } = makeSubsystem({
      chat: {
        createRoom: async (input: Parameters<FileBackedChatService["createRoom"]>[0]) => {
          received = input;
          return room;
        },
      },
    });

    await subsystem.handleChatCreateRequest({
      type: "chat/create",
      requestId: "c3",
      name: "legacy",
    });

    expect(received?.workspaceId).toBeUndefined();
    expect(received?.projectId).toBeUndefined();
    expect(findByType(emitted, "chat/create/response")?.payload.error).toBeNull();
  });

  it("schedule/create returns a summary with the runs stripped", async () => {
    const stored = {
      id: "s1",
      name: null,
      prompt: "p",
      cadence: { type: "every" as const, everyMs: 1000 },
      target: { type: "agent" as const, agentId: "a" },
      status: "active" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      nextRunAt: null,
      lastRunAt: null,
      pausedAt: null,
      expiresAt: null,
      maxRuns: null,
      runs: [
        {
          id: "run-1",
          scheduledFor: "2026-01-01T00:00:00.000Z",
          startedAt: "2026-01-01T00:00:00.000Z",
          endedAt: null,
          status: "running" as const,
          agentId: null,
          output: null,
          error: null,
        },
      ],
    };
    const { subsystem, emitted } = makeSubsystem({ schedule: { create: async () => stored } });

    await subsystem.handleScheduleCreateRequest({
      type: "schedule/create",
      requestId: "sc1",
      prompt: "p",
      cadence: { type: "every", everyMs: 1000 },
      target: { type: "agent", agentId: "a" },
    });

    const res = findByType(emitted, "schedule/create/response");
    expect(res?.payload.schedule).toBeDefined();
    expect(res?.payload.schedule).not.toHaveProperty("runs");
    expect(res?.payload.schedule.id).toBe("s1");
  });

  it("schedule/create remaps a self target to an agent target before creating", async () => {
    let received: Parameters<ScheduleService["create"]>[0] | undefined;
    const stored = {
      id: "s2",
      name: null,
      prompt: "p",
      cadence: { type: "every" as const, everyMs: 1000 },
      target: { type: "agent" as const, agentId: "agent-9" },
      status: "active" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      nextRunAt: null,
      lastRunAt: null,
      pausedAt: null,
      expiresAt: null,
      maxRuns: null,
      runs: [],
    };
    const { subsystem, emitted } = makeSubsystem({
      schedule: {
        create: async (input: Parameters<ScheduleService["create"]>[0]) => {
          received = input;
          return stored;
        },
      },
    });

    await subsystem.handleScheduleCreateRequest({
      type: "schedule/create",
      requestId: "sc2",
      prompt: "p",
      cadence: { type: "every", everyMs: 1000 },
      target: { type: "self", agentId: "agent-9" },
    });

    expect(received?.target).toEqual({ type: "agent", agentId: "agent-9" });
    expect(findByType(emitted, "schedule/create/response")?.payload.error).toBeNull();
  });
});
