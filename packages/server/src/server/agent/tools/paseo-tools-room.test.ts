import { describe, expect, test } from "vitest";
import pino from "pino";
import type { ChatMessage, ChatRoomDetail } from "@getpaseo/protocol/chat/types";
import type { AgentManager, ManagedAgent } from "../agent-manager.js";
import type { AgentStorage, StoredAgentRecord } from "../agent-storage.js";
import type { ProviderSnapshotManager } from "../provider-snapshot-manager.js";
import type { FileBackedChatService } from "../../chat/chat-service.js";
import { createPaseoToolCatalog } from "./paseo-tools.js";

class RoomAgentManagerFake {
  public constructor(private readonly roleId?: "lead" | "peer" | "supervisor") {}

  public getRoleBindingForToolCatalog(agentId: string) {
    return agentId === "agent-caller" && this.roleId ? { roleId: this.roleId } : undefined;
  }

  public getAgent(agentId: string): ManagedAgent | null {
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
    } as ManagedAgent;
  }

  public listAgents(): ManagedAgent[] {
    return [];
  }
}

class RoomAgentStorageFake {
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
  chatService?: RoomChatServiceFake;
  enablePosting?: boolean;
}) {
  return createPaseoToolCatalog({
    agentManager: new RoomAgentManagerFake(options.roleId) as unknown as AgentManager,
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
    expect(supervisor.getTool("create_room")).toBeUndefined();
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
