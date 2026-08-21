import { describe, expect, test } from "vitest";
import pino from "pino";
import type { ChatMessage, ChatRoomDetail } from "@getpaseo/protocol/chat/types";
import type { AgentManager, ManagedAgent } from "../agent-manager.js";
import type { AgentStorage, StoredAgentRecord } from "../agent-storage.js";
import type { ProviderSnapshotManager } from "../provider-snapshot-manager.js";
import type { FileBackedChatService } from "../../chat/chat-service.js";
import { createPaseoToolCatalog } from "./paseo-tools.js";

class RoomAgentManagerFake {
  public readonly metadataUpdates: Array<{
    agentId: string;
    updates: { title?: string; labels?: Record<string, string> };
  }> = [];

  public constructor(
    private readonly roleId?: "lead" | "peer" | "supervisor",
    private readonly child?: ManagedAgent,
  ) {}

  public getRoleBindingForToolCatalog(agentId: string) {
    return agentId === "agent-caller" && this.roleId ? { roleId: this.roleId } : undefined;
  }

  public getAgent(agentId: string): ManagedAgent | null {
    if (agentId === this.child?.id) {
      return this.child;
    }
    if (agentId !== "agent-caller") {
      return null;
    }
    return {
      id: agentId,
      cwd: "/tmp/room-agent",
      workspaceId: "workspace-room",
      internal: false,
      lifecycle: "idle",
      currentModeId: null,
      availableModes: [],
      config: { title: "Room caller" },
      labels: {},
    } as ManagedAgent;
  }

  public listAgents(): ManagedAgent[] {
    return [];
  }

  public async updateAgentMetadata(
    agentId: string,
    updates: { title?: string; labels?: Record<string, string> },
  ): Promise<void> {
    this.metadataUpdates.push({ agentId, updates });
  }
}

class RoomAgentStorageFake {
  public async get(): Promise<StoredAgentRecord | null> {
    return null;
  }

  public async list(): Promise<StoredAgentRecord[]> {
    return [];
  }
}

class RoomChatServiceFake {
  public readonly created: Array<Parameters<FileBackedChatService["createRoom"]>[0]> = [];
  public readonly dispatched: Array<Parameters<FileBackedChatService["dispatchMessage"]>[0]> = [];

  public async createRoom(
    input: Parameters<FileBackedChatService["createRoom"]>[0],
  ): Promise<ChatRoomDetail> {
    this.created.push(input);
    return {
      id: "room-1",
      name: input.name,
      purpose: input.purpose ?? null,
      createdAt: "2026-08-12T00:00:00.000Z",
      updatedAt: "2026-08-12T00:00:00.000Z",
      messageCount: 0,
      lastMessageAt: null,
    };
  }

  public async readMessages(): Promise<ChatMessage[]> {
    return [];
  }

  public async listRoomPosterAgentIds(): Promise<string[]> {
    return [];
  }

  public async dispatchMessage(
    input: Parameters<FileBackedChatService["dispatchMessage"]>[0],
  ): Promise<ChatMessage> {
    this.dispatched.push(input);
    return {
      id: "message-1",
      roomId: input.room,
      authorAgentId: input.authorAgentId,
      body: input.body,
      replyToMessageId: input.replyToMessageId ?? null,
      mentionAgentIds: [],
      createdAt: "2026-08-04T00:00:00.000Z",
    };
  }
}

function createCatalog(options: {
  callerAgentId?: string;
  roleId?: "lead" | "peer" | "supervisor";
  agentManager?: RoomAgentManagerFake;
  chatService?: RoomChatServiceFake;
  enablePosting?: boolean;
}) {
  return createPaseoToolCatalog({
    agentManager: (options.agentManager ??
      new RoomAgentManagerFake(options.roleId)) as unknown as AgentManager,
    agentStorage: new RoomAgentStorageFake() as unknown as AgentStorage,
    providerSnapshotManager: {} as ProviderSnapshotManager,
    callerAgentId: options.callerAgentId,
    chatService: options.chatService as unknown as FileBackedChatService,
    ...(options.enablePosting
      ? {
          resolveAgentIdentifier: async (identifier: string) => ({
            ok: true as const,
            agentId: identifier,
          }),
          sendAgentMessage: async () => {},
        }
      : {}),
    logger: pino({ level: "silent" }),
  });
}

describe("Paseo room tools", () => {
  test("only exposes room tools to an agent-scoped catalog", () => {
    const chatService = new RoomChatServiceFake();
    const topLevel = createCatalog({ chatService, enablePosting: true });
    const agentReader = createCatalog({ callerAgentId: "agent-caller", chatService });
    const agentPoster = createCatalog({
      callerAgentId: "agent-caller",
      chatService,
      enablePosting: true,
    });

    expect(topLevel.getTool("read_room")).toBeUndefined();
    expect(topLevel.getTool("post_room")).toBeUndefined();
    expect(topLevel.getTool("create_room")).toBeUndefined();
    expect(agentReader.getTool("read_room")).toBeDefined();
    expect(agentReader.getTool("post_room")).toBeUndefined();
    expect(agentReader.getTool("create_room")).toBeUndefined();
    expect(agentPoster.getTool("post_room")).toBeDefined();
  });

  test("lets only a role-bound Lead create a room", async () => {
    const chatService = new RoomChatServiceFake();
    const lead = createCatalog({
      callerAgentId: "agent-caller",
      roleId: "lead",
      chatService,
    });
    const peer = createCatalog({
      callerAgentId: "agent-caller",
      roleId: "peer",
      chatService,
    });
    const supervisor = createCatalog({
      callerAgentId: "agent-caller",
      roleId: "supervisor",
      chatService,
    });

    expect(peer.getTool("create_room")).toBeUndefined();
    expect(peer.getTool("start_council")).toBeUndefined();
    expect(peer.getTool("record_council_seat")).toBeUndefined();
    expect(supervisor.getTool("create_room")).toBeUndefined();
    expect(supervisor.getTool("start_council")).toBeUndefined();
    const result = await lead.executeTool("create_room", {
      name: "council-case",
      purpose: "One bounded challenge and response",
    });

    expect(chatService.created).toEqual([
      { name: "council-case", purpose: "One bounded challenge and response" },
    ]);
    expect(result.structuredContent).toEqual({
      room: expect.objectContaining({ id: "room-1", name: "council-case" }),
    });
  });

  test("starts a Lead-owned Council with one Room and canonical Peer seat plans", async () => {
    const chatService = new RoomChatServiceFake();
    const lead = createCatalog({
      callerAgentId: "agent-caller",
      roleId: "lead",
      chatService,
    });

    const result = await lead.executeTool("start_council", {
      title: "Choose the implementation boundary",
      question: "Which change is smallest and still technically enforced?",
    });

    expect(chatService.created).toHaveLength(1);
    expect(chatService.dispatched).toEqual([
      expect.objectContaining({
        room: "room-1",
        authorAgentId: "agent-caller",
        body: expect.stringContaining("Sealed seats: scout, architect, reviewer"),
      }),
    ]);
    expect(result.structuredContent).toEqual(
      expect.objectContaining({
        caseId: expect.stringMatching(/^case_[a-f0-9]{12}$/u),
        phase: "sealed",
        room: expect.objectContaining({ id: "room-1" }),
        seats: [
          expect.objectContaining({ role: "scout", peerSubrole: "scout" }),
          expect.objectContaining({
            role: "architect",
            peerSubrole: "architect",
            executionProfile: "solution-architect",
          }),
          expect.objectContaining({
            role: "reviewer",
            peerSubrole: "reviewer",
            executionProfile: "reviewer",
          }),
        ],
      }),
    );
  });

  test("lets a Lead record only its own direct Peer Council seat", async () => {
    const child = {
      id: "peer-seat",
      cwd: "/tmp/room-agent",
      workspaceId: "workspace-room",
      internal: false,
      lifecycle: "idle",
      currentModeId: null,
      availableModes: [],
      config: { title: "Scout seat" },
      labels: {
        "paseo.parent-agent-id": "agent-caller",
        "council.case_id": "case_123456789abc",
      },
      roleBinding: { roleId: "peer" },
    } as ManagedAgent;
    const agentManager = new RoomAgentManagerFake("lead", child);
    const lead = createCatalog({
      callerAgentId: "agent-caller",
      roleId: "lead",
      agentManager,
      chatService: new RoomChatServiceFake(),
    });

    const result = await lead.executeTool("record_council_seat", {
      caseId: "case_123456789abc",
      agentId: "peer-seat",
      phase: "review",
      integrity: "valid",
      disposition: "usable independent report",
    });

    expect(agentManager.metadataUpdates).toEqual([
      {
        agentId: "peer-seat",
        updates: {
          labels: {
            "council.phase": "review",
            "council.integrity": "valid",
            "council.disposition": "usable independent report",
          },
        },
      },
    ]);
    expect(result.structuredContent).toEqual({
      agentId: "peer-seat",
      caseId: "case_123456789abc",
      phase: "review",
      integrity: "valid",
      disposition: "usable independent report",
    });
  });

  test("binds post_room author identity to the calling agent", async () => {
    const chatService = new RoomChatServiceFake();
    const catalog = createCatalog({
      callerAgentId: "agent-caller",
      chatService,
      enablePosting: true,
    });

    const result = await catalog.executeTool("post_room", {
      room: "release-room",
      body: "Ready for review",
      authorAgentId: "spoofed-agent",
    });

    expect(chatService.dispatched).toEqual([
      expect.objectContaining({
        room: "release-room",
        body: "Ready for review",
        authorAgentId: "agent-caller",
      }),
    ]);
    expect(result.structuredContent).toEqual({
      message: expect.objectContaining({ authorAgentId: "agent-caller" }),
    });
  });
});
